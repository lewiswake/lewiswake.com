import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  signInWithCustomToken,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  setDoc,
  writeBatch,
  query,
  getDocs,
  serverTimestamp as fbServerTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const GIG_CUTOFF_HOUR = 6;
const GIG_TIMEZONE = "Europe/London";

function _tzPartsFromUTC(utcMs, tz = GIG_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(utcMs))
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
  };
}

function normalizeGigDate(
  utcMs,
  cutoffHour = GIG_CUTOFF_HOUR,
  tz = GIG_TIMEZONE
) {
  const { year, month, day, hour } = _tzPartsFromUTC(utcMs, tz);
  const baseUTC = Date.UTC(year, month - 1, day);
  const d = new Date(baseUTC);
  if (hour < cutoffHour) d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const customDialog = document.getElementById("customDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
let dialogConfirm = document.getElementById("dialogConfirm");
let dialogCancel = document.getElementById("dialogCancel");
const dialogActions = document.getElementById("dialogActions");

function showDialog({ title, message, isConfirm = false }) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    dialogActions.style.display = isConfirm ? "flex" : "block";
    dialogCancel.hidden = !isConfirm;

    const newConfirm = dialogConfirm.cloneNode(true);
    dialogConfirm.parentNode.replaceChild(newConfirm, dialogConfirm);
    dialogConfirm = newConfirm;

    const newCancel = dialogCancel.cloneNode(true);
    dialogCancel.parentNode.replaceChild(newCancel, dialogCancel);
    dialogCancel = newCancel;

    if (isConfirm) {
      dialogConfirm.textContent = "Yes";
      dialogConfirm.addEventListener(
        "click",
        () => {
          customDialog.style.display = "none";
          resolve(true);
        },
        { once: true }
      );
      dialogCancel.addEventListener(
        "click",
        () => {
          customDialog.style.display = "none";
          resolve(false);
        },
        { once: true }
      );
    } else {
      dialogConfirm.textContent = "OK";
      dialogConfirm.addEventListener(
        "click",
        () => {
          customDialog.style.display = "none";
          resolve(true);
        },
        { once: true }
      );
    }

    customDialog.style.display = "flex";
  });
}
window.customAlert = (message) =>
  showDialog({ title: "Notification", message, isConfirm: false });
window.customConfirm = (message) =>
  showDialog({ title: "Confirm Action", message, isConfirm: true });

window.addEventListener("DOMContentLoaded", () => {
  const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";
  const firebaseConfig = JSON.parse(
    typeof __firebase_config !== "undefined" ? __firebase_config : "{}"
  );

  if (Object.keys(firebaseConfig).length === 0) {
    console.error("Firebase config is missing. Cannot initialize app.");
    document.getElementById(
      "app"
    ).innerHTML = `<p style="text-align:center;color:var(--danger);">Configuration error. Please check your Firebase setup.</p>`;
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const appShell = document.getElementById("appShell");
  const appElement = document.getElementById("app");
  const userBadge = document.getElementById("userBadge");
  const viewTitle = document.getElementById("viewTitle");
  const backButton = document.getElementById("backButton");
  const feed = document.getElementById("feed");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const statusFilter = document.getElementById("statusFilter");
  const sortOrder = document.getElementById("sortOrder");
  const decadeFilter = document.getElementById("decadeFilter");
  const genreFilter = document.getElementById("genreFilter");
  const signOutBtn = document.getElementById("signOutBtn");
  const menuToggle = document.getElementById("menuToggle");
  const navDrawer = document.getElementById("navDrawer");
  const navOverlay = document.getElementById("navOverlay");

  const authContainer = document.getElementById("authContainer");
  const authTitle = document.getElementById("authTitle");
  const authError = document.getElementById("authError");
  const authForm = document.getElementById("authForm");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const authPrimaryBtn = document.getElementById("authPrimaryBtn");
  const toggleAuthBtn = document.getElementById("toggleAuthBtn");

  let currentView = "home";
  let selectedDate = null;
  const requestsMap = Object.create(null);
  let renderQueued = false;
  let dateGroups = {};
  let unsubscribeRequests = null;
  let isSigningUp = false;

  const desktopQuery = window.matchMedia("(min-width: 1024px)");
  let isDesktop = desktopQuery.matches;
  let mobileNavOpen = false;
  let lastFocusedBeforeNav = null;

  function showAuthUI() {
    appElement.hidden = true;
    appElement.style.display = "none";
    authContainer.hidden = false;
    authContainer.style.display = "flex";
    userBadge.textContent = "Guest";
  }

  function hideAuthUI(user) {
    authContainer.hidden = true;
    authContainer.style.display = "none";
    appElement.hidden = false;
    appElement.style.display = "";
    userBadge.textContent = (user && (user.email || user.uid)) || "Signed in";
  }

  function showAuthError(message) {
    authError.textContent = message;
    authError.hidden = false;
  }

  function hideAuthError() {
    authError.hidden = true;
  }

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
      }
      showAuthUI();
      return;
    }

    hideAuthUI(user);
    subscribeRequests();
    scheduleRender();
  });

  toggleAuthBtn.addEventListener("click", () => {
    isSigningUp = !isSigningUp;
    authTitle.textContent = isSigningUp
      ? "DJ Dashboard Sign Up"
      : "DJ Dashboard Login";
    authPrimaryBtn.textContent = isSigningUp ? "Sign Up" : "Sign In";
    toggleAuthBtn.textContent = isSigningUp
      ? "Already have an account? Sign In"
      : "Need an account? Sign Up";
    hideAuthError();
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      showAuthError("Please enter both email and password.");
      return;
    }

    try {
      if (isSigningUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      hideAuthUI(auth.currentUser);
    } catch (error) {
      let errorMessage = "An unknown error occurred.";

      if (error.code) {
        switch (error.code) {
          case "auth/user-not-found":
            errorMessage = "No user found with this email.";
            break;
          case "auth/wrong-password":
            errorMessage = "Incorrect password.";
            break;
          case "auth/email-already-in-use":
            errorMessage = "This email is already in use. Try signing in.";
            break;
          case "auth/weak-password":
            errorMessage = "Password should be at least 6 characters.";
            break;
          case "auth/invalid-email":
            errorMessage = "The email address is not valid.";
            break;
          case "auth/network-request-failed":
            errorMessage =
              "Network error. Please check your internet connection.";
            break;
          case "auth/operation-not-allowed":
            errorMessage =
              "Email/Password sign-in is disabled for this project.";
            break;
          default:
            errorMessage = `Authentication failed: ${error.message}`;
        }
      } else {
        errorMessage = error.message || "An unknown network error occurred.";
      }

      showAuthError(errorMessage);
      console.error("Auth error:", error);
    }
  });

  signOutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-out failed", err);
      customAlert("Sign-out failed. Please try again.");
    }
  });

  function recomputeDateGroups() {
    const groups = {};
    Object.values(requestsMap).forEach((req) => {
      const ts = Number(req.timestamp);
      if (!Number.isFinite(ts)) return;
      const isoDate = getISODate(ts);
      if (!isoDate) return;
      if (!groups[isoDate]) {
        groups[isoDate] = { count: 0, timestamp: ts };
      } else if (ts < groups[isoDate].timestamp) {
        groups[isoDate].timestamp = ts;
      }
      groups[isoDate].count++;
    });
    dateGroups = groups;
    return Object.keys(groups).sort().reverse();
  }

  function getRequestWeight(req) {
    const raw = Number(req?.count);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return raw;
  }

  function getArtworkUrl(req) {
    if (!req || typeof req !== "object") return "";
    return (
      req.artworkUrl ||
      req.artwork_url ||
      req.artwork ||
      req.albumArtUrl ||
      req.coverArtUrl ||
      req.imageUrl ||
      req.coverUrl ||
      ""
    );
  }

  function toCssUrl(value) {
    if (!value) return "";
    return `url("${String(value).replace(/"/g, '\\"')}")`;
  }

  const numberFormatter = new Intl.NumberFormat();

  function formatNumber(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return "0";
    return numberFormatter.format(num);
  }

  function getTopSongs(limit = 10) {
    const map = new Map();
    let totalRequests = 0;
    Object.values(requestsMap).forEach((req) => {
      const title = (req?.title || "").trim();
      if (!title) return;
      const artist = (req?.artist || "").trim();
      const key = `${title.toLowerCase()}\u0000${artist.toLowerCase()}`;
      const weight = getRequestWeight(req);
      totalRequests += weight;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          label: title,
          sublabel: artist || null,
          count: 0,
          artworkUrl: "",
        };
        map.set(key, entry);
      }
      entry.count += weight;
      if (artist && !entry.sublabel) entry.sublabel = artist;
      const artUrl = getArtworkUrl(req);
      if (!entry.artworkUrl && artUrl) entry.artworkUrl = artUrl;
      if (
        title &&
        entry.label &&
        entry.label === entry.label.toLowerCase() &&
        title !== title.toLowerCase()
      ) {
        entry.label = title;
      }
    });
    const items = [...map.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      )
      .slice(0, limit);
    return {
      items,
      totalRequests,
      totalUnique: map.size,
      maxCount: items[0]?.count || 0,
    };
  }

  function getTopArtists(limit = 10) {
    const map = new Map();
    let totalRequests = 0;
    Object.values(requestsMap).forEach((req) => {
      const artist = (req?.artist || "").trim();
      if (!artist) return;
      const key = artist.toLowerCase();
      const weight = getRequestWeight(req);
      totalRequests += weight;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          label: artist,
          count: 0,
        };
        map.set(key, entry);
      }
      entry.count += weight;
      if (
        artist &&
        entry.label &&
        entry.label === entry.label.toLowerCase() &&
        artist !== artist.toLowerCase()
      ) {
        entry.label = artist;
      }
    });
    const items = [...map.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      )
      .slice(0, limit);
    return {
      items,
      totalRequests,
      totalUnique: map.size,
      maxCount: items[0]?.count || 0,
    };
  }

  function getTopGenres(limit = 10) {
    const map = new Map();
    let totalRequests = 0;
    Object.values(requestsMap).forEach((req) => {
      const genre = (req?.genre || "").trim();
      if (!genre) return;
      const key = genre.toLowerCase();
      const weight = getRequestWeight(req);
      totalRequests += weight;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          label: genre,
          count: 0,
        };
        map.set(key, entry);
      }
      entry.count += weight;
      if (
        genre &&
        entry.label &&
        entry.label === entry.label.toLowerCase() &&
        genre !== genre.toLowerCase()
      ) {
        entry.label = genre;
      }
    });
    const items = [...map.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      )
      .slice(0, limit);
    return {
      items,
      totalRequests,
      totalUnique: map.size,
      maxCount: items[0]?.count || 0,
    };
  }

  const METRIC_VIEWS = {
    "metrics-songs": {
      title: "Most Requested Songs",
      description:
        "Top ten songs that have been requested across all events and dates.",
      getData: getTopSongs,
      summary: ({ totalRequests, totalUnique }) =>
        `Aggregated from ${formatNumber(
          totalRequests
        )} total requests across ${formatNumber(totalUnique)} unique songs.`,
    },
    "metrics-artists": {
      title: "Top Requested Artists",
      description:
        "Artists ranked by the total number of requests across the full history.",
      getData: getTopArtists,
      summary: ({ totalRequests, totalUnique }) =>
        `Aggregated from ${formatNumber(
          totalRequests
        )} total requests across ${formatNumber(totalUnique)} unique artists.`,
    },
    "metrics-genres": {
      title: "Top Requested Genres",
      description:
        "Most popular genres based on cumulative request counts in the database.",
      getData: getTopGenres,
      summary: ({ totalRequests, totalUnique }) =>
        `Aggregated from ${formatNumber(
          totalRequests
        )} total requests across ${formatNumber(totalUnique)} genres.`,
    },
  };

  function getNavLinks() {
    if (!navDrawer) return [];
    return Array.from(navDrawer.querySelectorAll(".nav-link"));
  }

  function focusableNavElements() {
    if (!navDrawer) return [];
    const selectors =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(navDrawer.querySelectorAll(selectors)).filter((el) => {
      return (
        el.offsetParent !== null ||
        window.getComputedStyle(el).position === "fixed"
      );
    });
  }

  function focusFirstNavItem() {
    const items = getNavLinks();
    if (items.length) {
      items[0].focus();
      return;
    }
    const focusables = focusableNavElements();
    if (focusables.length) focusables[0].focus();
  }

  function handleNavKeydown(event) {
    if (!navDrawer) return;
    if (mobileNavOpen && event.key === "Tab") {
      const focusables = focusableNavElements();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === "Escape" && mobileNavOpen) {
      event.preventDefault();
      closeMobileNav();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = getNavLinks();
    if (!links.length) return;
    const current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest(".nav-link")
        : null;
    const currentIndex = current ? links.indexOf(current) : -1;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < links.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : links.length - 1;
    }
    if (nextIndex >= 0 && links[nextIndex]) {
      event.preventDefault();
      links[nextIndex].focus();
    }
  }

  function openMobileNav() {
    if (!navDrawer || isDesktop || mobileNavOpen) return;
    mobileNavOpen = true;
    lastFocusedBeforeNav =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    navDrawer.setAttribute("aria-hidden", "false");
    navDrawer.setAttribute("role", "dialog");
    navDrawer.setAttribute("aria-modal", "true");
    navDrawer.setAttribute("tabindex", "-1");
    navDrawer.setAttribute("aria-labelledby", "navDrawerTitle");

    if (navOverlay) {
      navOverlay.hidden = false;
      requestAnimationFrame(() => navOverlay.classList.add("active"));
    }
    document.body.classList.add("drawer-open");
    if (appShell) appShell.classList.add("nav-mobile-open");

    requestAnimationFrame(() => {
      navDrawer.focus();
      focusFirstNavItem();
    });

    if (menuToggle) menuToggle.setAttribute("aria-expanded", "true");
  }

  function closeMobileNav({ restoreFocus = true } = {}) {
    if (!navDrawer || !mobileNavOpen) return;
    mobileNavOpen = false;

    navDrawer.setAttribute("aria-hidden", "true");
    navDrawer.setAttribute("role", "navigation");
    navDrawer.removeAttribute("aria-modal");
    navDrawer.removeAttribute("tabindex");

    if (navOverlay) {
      navOverlay.classList.remove("active");
      navOverlay.hidden = true;
    }
    document.body.classList.remove("drawer-open");
    if (appShell) appShell.classList.remove("nav-mobile-open");

    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");

    if (restoreFocus && lastFocusedBeforeNav instanceof HTMLElement) {
      lastFocusedBeforeNav.focus();
    }
    lastFocusedBeforeNav = null;
  }

  function applyNavMode() {
    isDesktop = desktopQuery.matches;
    if (isDesktop) {
      closeMobileNav({ restoreFocus: false });
      if (navDrawer) {
        navDrawer.setAttribute("aria-hidden", "false");
        navDrawer.setAttribute("role", "navigation");
        navDrawer.removeAttribute("aria-modal");
        navDrawer.removeAttribute("tabindex");
        navDrawer.setAttribute("aria-labelledby", "navDrawerTitle");
      }
      if (navOverlay) {
        navOverlay.hidden = true;
        navOverlay.classList.remove("active");
      }
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    } else {
      if (!mobileNavOpen && navDrawer) {
        navDrawer.setAttribute("aria-hidden", "true");
        navDrawer.setAttribute("role", "navigation");
        navDrawer.removeAttribute("aria-modal");
        navDrawer.removeAttribute("tabindex");
      }
      if (menuToggle) {
        menuToggle.setAttribute(
          "aria-expanded",
          mobileNavOpen ? "true" : "false"
        );
      }
    }
    updateNavActiveState();
  }

  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", applyNavMode);
  } else if (typeof desktopQuery.addListener === "function") {
    desktopQuery.addListener(applyNavMode);
  }

  applyNavMode();

  function escapeForSelector(value) {
    if (!value) return "";
    return typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(value)
      : String(value).replace(/([^\w-])/g, "\\$1");
  }

  function updateNavActiveState() {
    const links = getNavLinks();
    links.forEach((link) => link.classList.remove("is-active"));
    if (!navDrawer) return;

    if (currentView === "home") {
      const homeLink = navDrawer.querySelector("[data-nav-home]");
      if (homeLink) homeLink.classList.add("is-active");
      return;
    }

    if (currentView === "date" && selectedDate) {
      const selector = `.nav-link[data-date="${escapeForSelector(
        selectedDate
      )}"]`;
      const dateLink = navDrawer.querySelector(selector);
      if (dateLink) {
        dateLink.classList.add("is-active");
        return;
      }
    }

    if (METRIC_VIEWS[currentView]) {
      const selector = `.nav-link[data-metrics-view="${escapeForSelector(
        currentView
      )}"]`;
      const metricLink = navDrawer.querySelector(selector);
      if (metricLink) {
        metricLink.classList.add("is-active");
        return;
      }
    }
  }

  if (navDrawer) {
    navDrawer.addEventListener("keydown", handleNavKeydown);
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      if (isDesktop) return;
      if (mobileNavOpen) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (navDrawer) {
    navDrawer.addEventListener("click", (event) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || !navDrawer.contains(link)) return;
      const metricsView = link.dataset.metricsView;
      const date = link.dataset.date;
      const isHome = Object.prototype.hasOwnProperty.call(
        link.dataset,
        "navHome"
      );
      let handled = false;

      if (metricsView) {
        event.preventDefault();
        navigateToMetrics(metricsView);
        handled = true;
      } else if (date) {
        event.preventDefault();
        navigateToDate(date);
        handled = true;
      } else if (isHome) {
        event.preventDefault();
        navigateHome();
        handled = true;
      }

      if (handled && !isDesktop) {
        closeMobileNav({ restoreFocus: false });
      }
    });
  }

  if (navOverlay) {
    navOverlay.addEventListener("click", () => closeMobileNav());
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileNavOpen) {
      closeMobileNav();
    }
  });

  document.addEventListener("click", (event) => {
    if (!mobileNavOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (navDrawer?.contains(target)) return;
    if (menuToggle && menuToggle.contains(target)) return;
    closeMobileNav({ restoreFocus: false });
  });

  function navigateHome() {
    selectedDate = null;
    currentView = "home";
    scheduleRender();
  }

  function navigateToDate(isoDate) {
    selectedDate = isoDate;
    currentView = "date";
    scheduleRender();
  }

  function escapeHtml(str) {
    return String(str || "").replace(
      /[&<>"]+/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function formatFullDate(ts, options = {}) {
    if (!ts) return null;
    const date = new Date(Number(ts));
    const defaultOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    const formatted = date.toLocaleDateString(undefined, {
      ...defaultOptions,
      ...options,
    });
    return formatted.replace(/,\s*/g, " ").replace(/\s+/g, " ").trim();
  }

  function getISODate(ts) {
    if (!ts && ts !== 0) return null;
    return normalizeGigDate(Number(ts));
  }

  function populateDecadeFilter() {
    const prior = decadeFilter.value;
    const unique = new Set();
    Object.values(requestsMap).forEach((req) => {
      const lbl = decadeLabel(req.releaseYear);
      if (lbl) unique.add(lbl);
    });
    const sorted = [...unique].sort();
    setChildren(decadeFilter, [option("all", "All Decades", prior === "all")]);
    for (const d of sorted) decadeFilter.appendChild(option(d, d, d === prior));
  }

  function populateGenreFilter() {
    const prior = genreFilter.value;
    const unique = new Set();
    Object.values(requestsMap).forEach((req) => {
      if (req.genre) unique.add(req.genre);
    });
    const sorted = [...unique].sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    setChildren(genreFilter, [option("all", "All Genres", prior === "all")]);
    for (const g of sorted) genreFilter.appendChild(option(g, g, g === prior));
  }

  function option(value, label, selected) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (selected) o.selected = true;
    return o;
  }

  function decadeLabel(year) {
    if (!year) return null;
    const start = Math.floor(Number(year) / 10) * 10;
    return `${start}s`;
  }

  function setChildren(el, children) {
    el.innerHTML = "";
    for (const child of children) el.appendChild(child);
  }

  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
    } catch {
      return "#";
    }
  }

  function createCard(req) {
    const card = document.createElement("article");
    card.className = "card" + (req.fulfilled ? " fulfilled" : "");
    card.dataset.id = req.key;
    card.setAttribute("role", "listitem");

    if (Number(req.count) > 1) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = String(req.count);
      card.appendChild(badge);
    }

    const img = document.createElement("img");
    img.className = "card-thumb";
    img.alt = "Artwork";
    img.decoding = "async";
    img.loading = "lazy";
    img.src = req.artworkUrl || "";
    img.onerror = () => {
      img.src = "";
      img.classList.add("thumb-missing");
    };
    card.appendChild(img);

    const content = document.createElement("div");
    content.className = "card-content";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = req.title || "Unknown title";
    const artist = document.createElement("div");
    artist.className = "card-artist";
    artist.textContent = req.artist || "Unknown artist";
    const meta = document.createElement("div");
    meta.className = "card-metadata";
    const parts = [];
    if (req.genre) parts.push(req.genre);
    if (req.releaseYear) parts.push(String(req.releaseYear));
    meta.textContent = parts.join(" | ");
    const time = document.createElement("div");
    time.className = "card-time";
    time.dataset.ts = String(req.timestamp || 0);
    time.textContent = msToTimeAgo(req.timestamp || Date.now());

    content.appendChild(title);
    content.appendChild(artist);
    content.appendChild(meta);
    content.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const link = document.createElement("a");
    link.className = "apple-music-link";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.href = safeUrl(req.appleMusicUrl || "#");
    link.textContent = "Listen on Apple Music";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-link";
    del.textContent = "Delete";
    del.setAttribute(
      "aria-label",
      `Delete request ${escapeHtml(req.title || "")}`
    );
    actions.appendChild(link);
    actions.appendChild(del);

    content.appendChild(actions);

    const label = document.createElement("label");
    label.className = "checkbox-container";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox";
    checkbox.checked = !!req.fulfilled;
    checkbox.setAttribute("data-action", "toggle");
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    label.appendChild(checkbox);
    label.appendChild(checkmark);

    card.appendChild(content);
    card.appendChild(label);
    return card;
  }

  function msToTimeAgo(timestamp) {
    if (!timestamp) return "now";
    const delta = Date.now() - Number(timestamp);
    if (!isFinite(delta)) return "now";
    const sec = Math.floor(delta / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  function getFilteredSortedRequests() {
    const status = statusFilter.value;
    const sort = sortOrder.value;
    const decade = decadeFilter.value;
    const genre = genreFilter.value;

    let arr = Object.values(requestsMap);
    if (selectedDate)
      arr = arr.filter((r) => getISODate(r.timestamp) === selectedDate);
    if (status === "unplayed") arr = arr.filter((r) => !r.fulfilled);
    if (status === "played") arr = arr.filter((r) => r.fulfilled);
    if (decade !== "all")
      arr = arr.filter((r) => decadeLabel(r.releaseYear) === decade);
    if (genre !== "all") arr = arr.filter((r) => r.genre === genre);

    arr.sort((a, b) => {
      switch (sort) {
        case "mostRequested":
          return Number(b.count || 0) - Number(a.count || 0);
        case "latestAdded":
          return Number(b.timestamp || 0) - Number(a.timestamp || 0);
        case "earliestAdded":
          return Number(a.timestamp || 0) - Number(b.timestamp || 0);
        case "lastRequested":
          return Number(b.lastRequested || 0) - Number(a.lastRequested || 0);
        default:
          return Number(b.timestamp || 0) - Number(a.timestamp || 0);
      }
    });
    return arr;
  }

  function renderDateView() {
    const items = getFilteredSortedRequests();

    if (selectedDate) {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const displayDate = formatFullDate(Date.UTC(y, m - 1, d));
      viewTitle.textContent = displayDate;
    } else if (items.length > 0) {
      viewTitle.textContent = formatFullDate(items[0].timestamp);
    } else {
      viewTitle.textContent = "Requests";
    }

    feed.className = "feed";
    feed.innerHTML = "";
    const frag = document.createDocumentFragment();
    if (items.length === 0) {
      feed.innerHTML = `<p style="text-align: center; color: var(--muted);">No requests match the current filters.</p>`;
      return;
    }
    for (const req of items) frag.appendChild(createCard(req));
    feed.appendChild(frag);
  }

  function renderMetricsView(viewKey) {
    const config = METRIC_VIEWS[viewKey];
    if (!config) return;
    viewTitle.textContent = config.title;
    feed.className = "feed metrics";
    feed.innerHTML = "";

    const data = config.getData?.(10) || {
      items: [],
      totalRequests: 0,
      totalUnique: 0,
    };
    const items = Array.isArray(data.items) ? data.items : [];

    if (config.description) {
      const desc = document.createElement("p");
      desc.className = "metrics-description";
      desc.textContent = config.description;
      feed.appendChild(desc);
    }

    if (typeof config.summary === "function") {
      const summaryText = config.summary(data);
      if (summaryText) {
        const summary = document.createElement("p");
        summary.className = "metrics-description metrics-summary";
        summary.textContent = summaryText;
        feed.appendChild(summary);
      }
    }

    if (!items.length) {
      const empty = document.createElement("p");
      empty.style.textAlign = "center";
      empty.style.color = "var(--muted)";
      empty.textContent = "Not enough request data yet.";
      feed.appendChild(empty);
      return;
    }

    const maxCount = items[0]?.count || 1;
    const list = document.createElement("ol");
    list.className = "metrics-list";

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "metrics-item";

      const rank = document.createElement("span");
      rank.className = "metrics-rank";
      rank.textContent = String(index + 1);

      let thumb = null;
      if (viewKey === "metrics-songs") {
        thumb = document.createElement("div");
        thumb.className = "metrics-thumb";
        if (item.artworkUrl) {
          thumb.style.backgroundImage = toCssUrl(item.artworkUrl);
        } else {
          thumb.classList.add("missing");
          thumb.textContent = item.label
            ? item.label.charAt(0).toUpperCase()
            : "?";
        }
      }

      const info = document.createElement("div");
      info.className = "metrics-info";

      const label = document.createElement("span");
      label.className = "metrics-label";
      label.textContent = item.label;
      info.appendChild(label);

      if (item.sublabel) {
        const sub = document.createElement("span");
        sub.className = "metrics-sublabel";
        sub.textContent = item.sublabel;
        info.appendChild(sub);
      }

      const count = document.createElement("span");
      count.className = "metrics-count";
      const suffix = item.count === 1 ? "request" : "requests";
      count.textContent = `${formatNumber(item.count)} ${suffix}`;
      info.appendChild(count);

      const bar = document.createElement("div");
      bar.className = "metrics-bar";
      const fill = document.createElement("span");
      fill.className = "metrics-bar-fill";
      const percent = Math.max(8, Math.round((item.count / maxCount) * 100));
      fill.style.width = `${Math.min(percent, 100)}%`;
      bar.appendChild(fill);
      info.appendChild(bar);

      if (thumb) {
        li.append(rank, thumb, info);
      } else {
        li.append(rank, info);
      }
      list.appendChild(li);
    });

    feed.appendChild(list);
  }

  function renderHomeView(sortedDates) {
    viewTitle.textContent = "All dates";
    feed.className = "feed date-list";
    feed.innerHTML = "";

    const dates = sortedDates ?? Object.keys(dateGroups).sort().reverse();
    if (!dates.length) {
      feed.innerHTML = `<p style="text-align: center; color: var(--muted);">No song requests yet.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const isoDate of dates) {
      const dateInfo = dateGroups[isoDate];
      if (!dateInfo) continue;
      const link = document.createElement("a");
      link.className = "date-link new";
      link.href = "#";
      link.dataset.date = isoDate;
      const countText =
        dateInfo.count === 1
          ? "1 request"
          : `${formatNumber(dateInfo.count)} requests`;
      const displayDate = formatFullDate(dateInfo.timestamp) || isoDate;
      link.innerHTML = `${escapeHtml(displayDate)}<small>${countText}</small>`;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        navigateToDate(isoDate);
      });
      frag.appendChild(link);
    }
    feed.appendChild(frag);
  }

  function render() {
    renderQueued = false;
    appElement.className = "view-" + currentView;
    const sortedDates = recomputeDateGroups();
    if (currentView === "home") {
      renderHomeView(sortedDates);
    } else if (currentView === "date") {
      renderDateView();
    } else if (METRIC_VIEWS[currentView]) {
      renderMetricsView(currentView);
    } else {
      renderHomeView(sortedDates);
    }
    updateNavActiveState();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  setInterval(() => {
    if (currentView === "date") {
      const nodes = feed.querySelectorAll(".card-time");
      nodes.forEach((n) => {
        const ts = Number(n.dataset.ts || 0);
        n.textContent = msToTimeAgo(ts);
      });
    }
  }, 60_000);

  function escapeCsv(v) {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportRequests() {
    const all = getFilteredSortedRequests();
    if (!all.length) {
      customAlert("No requests to export for this view.");
      return;
    }
    all.sort((a, b) =>
      String(a.artist || "").localeCompare(String(b.artist || ""))
    );
    const header = [
      "Title",
      "Artist",
      "Genre",
      "ReleaseYear",
      "Count",
      "Fulfilled",
      "FirstAddedISO",
      "LastRequestedISO",
      "AppleMusicUrl",
    ];
    const rows = all.map((r) =>
      [
        escapeCsv(r.title),
        escapeCsv(r.artist),
        escapeCsv(r.genre || ""),
        escapeCsv(r.releaseYear || ""),
        escapeCsv(r.count || 0),
        escapeCsv(!!r.fulfilled),
        escapeCsv(
          r.timestamp ? new Date(Number(r.timestamp)).toISOString() : ""
        ),
        escapeCsv(
          r.lastRequested ? new Date(Number(r.lastRequested)).toISOString() : ""
        ),
        escapeCsv(r.appleMusicUrl || ""),
      ].join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const dateString = selectedDate || new Date().toISOString().slice(0, 10);
    const filename = `song-requests-${dateString}.csv`;
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  backButton.addEventListener("click", navigateHome);
  statusFilter.addEventListener("change", scheduleRender);
  sortOrder.addEventListener("change", scheduleRender);
  decadeFilter.addEventListener("change", scheduleRender);
  genreFilter.addEventListener("change", scheduleRender);
  exportCsvBtn.addEventListener("click", exportRequests);

  clearAllBtn.addEventListener("click", async () => {
    let itemsToClear = [];
    let confirmMessage = "";
    if (selectedDate) {
      itemsToClear = getFilteredSortedRequests();
      const dateInfo = dateGroups[selectedDate];
      const dateStr = dateInfo
        ? formatFullDate(dateInfo.timestamp)
        : selectedDate;
      confirmMessage = `Clear all ${itemsToClear.length} requests for ${dateStr}?`;
    } else {
      itemsToClear = Object.values(requestsMap);
      confirmMessage = `Clear *all* ${itemsToClear.length} song requests from *all dates*? This cannot be undone.`;
    }
    if (itemsToClear.length === 0) {
      customAlert("No requests to clear.");
      return;
    }

    if (!(await customConfirm(confirmMessage))) return;

    try {
      let docsToDelete = [];
      const requestsCol = collection(db, "requests");
      if (selectedDate) {
        itemsToClear.forEach((item) =>
          docsToDelete.push(doc(requestsCol, item.key))
        );
      } else {
        const snapshot = await getDocs(query(requestsCol));
        snapshot.docs.forEach((d) => docsToDelete.push(d.ref));
      }

      if (docsToDelete.length === 0) return;

      const batchSize = 499;
      for (let i = 0; i < docsToDelete.length; i += batchSize) {
        const batch = writeBatch(db);
        const currentBatchDocs = docsToDelete.slice(i, i + batchSize);
        currentBatchDocs.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      if (selectedDate) navigateHome();
    } catch (err) {
      console.error("Failed to clear requests", err);
      customAlert("Failed to clear requests. Check console for details.");
    }
  });

  feed.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("checkbox")) return;
    const card = target.closest(".card");
    const id = card?.dataset.id;
    if (!id) return;
    const fulfilled = !!target.checked;

    if (requestsMap[id]) requestsMap[id].fulfilled = fulfilled;
    scheduleRender();

    const docRef = doc(db, "requests", id);
    updateDoc(docRef, {
      fulfilled,
      updatedAt: fbServerTimestamp(),
    }).catch((err) => {
      return setDoc(
        docRef,
        { fulfilled, updatedAt: fbServerTimestamp() },
        { merge: true }
      ).catch((err2) => {
        console.error("Toggle failed", { primary: err, fallback: err2 });
        if (requestsMap[id]) requestsMap[id].fulfilled = !fulfilled;
        target.checked = !fulfilled;
        scheduleRender();
        customAlert(
          (err2 && err2.message) || "Failed to update status. Please try again."
        );
      });
    });
  });

  feed.addEventListener("click", async (e) => {
    const delBtn = e.target.closest && e.target.closest(".delete-link");
    if (!delBtn) return;
    const card = delBtn.closest(".card");
    const id = card?.dataset.id;
    if (!id) return;

    if (!(await customConfirm("Delete this request? This cannot be undone.")))
      return;

    deleteDoc(doc(db, "requests", id)).catch((err) => {
      console.error("Failed to delete request", err);
      customAlert("Failed to delete. Please try again.");
    });
  });

  function subscribeRequests() {
    if (unsubscribeRequests) {
      unsubscribeRequests();
      unsubscribeRequests = null;
    }

    const q = query(collection(db, "requests"));

    unsubscribeRequests = onSnapshot(
      q,
      (snapshot) => {
        let filtersNeedUpdate = false;
        snapshot.docChanges().forEach(({ doc, type }) => {
          const oldData = requestsMap[doc.id];
          const newData = { ...doc.data(), key: doc.id };

          if (type === "removed") {
            delete requestsMap[doc.id];
          } else {
            requestsMap[doc.id] = newData;
          }

          if (
            type === "added" ||
            oldData?.genre !== newData?.genre ||
            oldData?.releaseYear !== newData?.releaseYear
          ) {
            filtersNeedUpdate = true;
          }
        });

        if (filtersNeedUpdate) {
          populateDecadeFilter();
          populateGenreFilter();
        }
        scheduleRender();
      },
      (err) => console.error("Live sync error:", err)
    );
  }

  function navigateToMetrics(viewKey) {
    if (!METRIC_VIEWS[viewKey]) return;
    selectedDate = null;
    currentView = viewKey;
    scheduleRender();
  }

  populateDecadeFilter();
  populateGenreFilter();

  scheduleRender();
});
