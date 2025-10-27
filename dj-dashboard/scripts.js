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

/* ================================
   6am Gig-Date Helpers (Europe/London)
   - Anything from 00:00–05:59 local time is treated as the *previous* day's gig date.
   - Used by getISODate() so your grouping & date views are gig-aware.
   ================================ */
const GIG_CUTOFF_HOUR = 6; // 06:00 cutoff boundary
const GIG_TIMEZONE = "Europe/London";

/** Extract local (tz) parts from a UTC-ms timestamp */
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

/** Convert UTC-ms to a gig date YYYY-MM-DD using the 6am cutoff in Europe/London */
function normalizeGigDate(
  utcMs,
  cutoffHour = GIG_CUTOFF_HOUR,
  tz = GIG_TIMEZONE
) {
  const { year, month, day, hour } = _tzPartsFromUTC(utcMs, tz);
  // Start from the local calendar date at midnight
  const baseUTC = Date.UTC(year, month - 1, day);
  const d = new Date(baseUTC);
  // Roll back if before cutoff
  if (hour < cutoffHour) d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// --- Custom Dialog Implementation (Replaces alert() and confirm()) ---
const customDialog = document.getElementById("customDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
let dialogConfirm = document.getElementById("dialogConfirm"); // made 'let'
let dialogCancel = document.getElementById("dialogCancel"); // made 'let'
const dialogActions = document.getElementById("dialogActions");

function showDialog({ title, message, isConfirm = false }) {
  console.log(
    `[DIALOG] Showing ${
      isConfirm ? "Confirm" : "Alert"
    } dialog: ${title} - ${message}`
  );
  return new Promise((resolve) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;

    // Only show 'Cancel' for confirmations
    dialogActions.style.display = isConfirm ? "flex" : "block";
    dialogCancel.hidden = !isConfirm;

    // Clone buttons to remove old listeners, then REBIND references
    const newConfirm = dialogConfirm.cloneNode(true);
    dialogConfirm.parentNode.replaceChild(newConfirm, dialogConfirm);
    dialogConfirm = newConfirm; // <-- rebind

    const newCancel = dialogCancel.cloneNode(true);
    dialogCancel.parentNode.replaceChild(newCancel, dialogCancel);
    dialogCancel = newCancel; // <-- rebind

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
  // --- CONFIG & INITIALIZATION (using global variables) ---
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

  // --- ELEMENT REFS ---
  const appElement = document.getElementById("app");
  const userBadge = document.getElementById("userBadge");
  const pageTitle = document.getElementById("pageTitle");
  const backButton = document.getElementById("backButton");
  const feed = document.getElementById("feed");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const statusFilter = document.getElementById("statusFilter");
  const sortOrder = document.getElementById("sortOrder");
  const decadeFilter = document.getElementById("decadeFilter");
  const genreFilter = document.getElementById("genreFilter");
  const signOutBtn = document.getElementById("signOutBtn");
  // New Auth Refs
  const authContainer = document.getElementById("authContainer");
  const authTitle = document.getElementById("authTitle");
  const authError = document.getElementById("authError");
  const authForm = document.getElementById("authForm");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const authPrimaryBtn = document.getElementById("authPrimaryBtn");
  const toggleAuthBtn = document.getElementById("toggleAuthBtn");

  // --- STATE ---
  let currentView = "home";
  let selectedDate = null;
  const requestsMap = Object.create(null);
  let renderQueued = false;
  let dateGroups = {};
  let unsubscribeRequests = null;
  let isSigningUp = false; // Auth state toggle

  // --- AUTH UI HELPERS (double-lock show/hide) ---
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

  // --- AUTH FEEDBACK ---
  function showAuthError(message) {
    authError.textContent = message;
    authError.hidden = false;
  }
  function hideAuthError() {
    authError.hidden = true;
  }

  // 2. Auth State Change Listener (Decides which view to show)
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // No user -> show login
      if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
      }
      showAuthUI();
      return;
    }

    // Signed in -> hide login & show app
    hideAuthUI(user);
    subscribeRequests();
    scheduleRender();
  }); // <-- IMPORTANT: close the auth state listener here

  // 3. Login/Signup Toggle
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

  // 4. Login/Signup Submit
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

      // Immediately hide overlay on success (UX polish + safety net)
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

  // 5. Sign Out
  signOutBtn?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      showAuthUI(); // ensure overlay returns after sign out
    } catch (e) {
      console.error(e);
    }
  });

  // --- UTILITIES ---
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  function msToTimeAgo(ts) {
    const now = Date.now();
    const diff = clamp(
      Math.floor((now - Number(ts)) / 1000),
      0,
      Number.MAX_SAFE_INTEGER
    );
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }
  function decadeLabel(year) {
    if (!year) return null;
    const start = Math.floor(Number(year) / 10) * 10;
    return `${start}s`;
  }
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
    } catch {
      return "#";
    }
  }
  function setChildren(el, children) {
    el.innerHTML = "";
    for (const child of children) el.appendChild(child);
  }
  function option(value, label, selected) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (selected) o.selected = true;
    return o;
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
    return date.toLocaleDateString(undefined, {
      ...defaultOptions,
      ...options,
    });
  }

  // *** UPDATED: returns GIG DATE (YYYY-MM-DD) with 6am cutoff in Europe/London ***
  function getISODate(ts) {
    if (!ts && ts !== 0) return null;
    return normalizeGigDate(Number(ts)); // uses helpers defined above
  }

  // --- NAVIGATION ---
  function navigateToDate(isoDate) {
    selectedDate = isoDate;
    currentView = "date";
    scheduleRender();
  }
  function navigateHome() {
    selectedDate = null;
    currentView = "home";
    scheduleRender();
  }

  // --- FILTERS ---
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

  // --- CARD CREATION ---
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

    // requester tab
    const requesterName =
      req.requesterName ||
      req.requestedBy ||
      req.userName ||
      req.user ||
      req.name ||
      "";
    if (requesterName) {
      const requesterEl = document.createElement("div");
      requesterEl.className = "requester-tab";
      requesterEl.setAttribute("aria-label", "Requested by");
      requesterEl.textContent = String(requesterName);
      content.appendChild(requesterEl);
    }

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
    del.setAttribute("data-action", "delete");
    actions.appendChild(link);
    actions.appendChild(del);

    content.appendChild(title);
    content.appendChild(artist);
    content.appendChild(meta);
    content.appendChild(time);
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

  // --- RENDER ---
  function getFilteredSortedRequests() {
    const status = statusFilter.value;
    const sort = sortOrder.value;
    const decade = decadeFilter.value;
    const genre = genreFilter.value;

    let arr = Object.values(requestsMap);
    // *** UPDATED: filter by gig-aware date ***
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

    // *** UPDATED: title is based on the selected gig date (not raw timestamp) ***
    if (selectedDate) {
      const [y, m, d] = selectedDate.split("-").map(Number);
      pageTitle.textContent = new Date(
        Date.UTC(y, m - 1, d)
      ).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } else if (items.length > 0) {
      pageTitle.textContent = formatFullDate(items[0].timestamp);
    } else {
      pageTitle.textContent = "Requests";
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

  function renderHomeView() {
    pageTitle.textContent = "Live Song Requests";
    feed.className = "feed date-list";
    feed.innerHTML = "";

    dateGroups = {};
    Object.values(requestsMap).forEach((req) => {
      // *** UPDATED: group by gig-aware ISO date ***
      const isoDate = getISODate(req.timestamp);
      if (!isoDate) return;
      if (!dateGroups[isoDate]) {
        dateGroups[isoDate] = { count: 0, timestamp: req.timestamp };
      }
      dateGroups[isoDate].count++;
    });

    const sortedDates = Object.keys(dateGroups).sort().reverse();
    if (sortedDates.length === 0) {
      feed.innerHTML = `<p style="text-align: center; color: var(--muted);">No song requests yet.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const isoDate of sortedDates) {
      const dateInfo = dateGroups[isoDate];
      const link = document.createElement("a");
      link.className = "date-link new";
      link.href = "#";
      link.dataset.date = isoDate;
      const countText =
        dateInfo.count === 1 ? "1 request" : `${dateInfo.count} requests`;
      // Title can still show a nice long date based on the *first* timestamp; that's fine for home
      link.innerHTML = `${formatFullDate(
        dateInfo.timestamp
      )}<small>${countText}</small>`;
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
    document.getElementById("app").className = "view-" + currentView;
    if (currentView === "home") renderHomeView();
    else renderDateView();
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

  // CSV export helpers
  function escapeCsv(v) {
    const s = String(v ?? "");
    if (/[,\n"]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
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

  // --- EVENTS ---
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

      // Batch delete logic (max 500 ops per batch)
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

  // Toggle + Delete
  feed.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("checkbox")) return;
    const card = target.closest(".card");
    const id = card?.dataset.id;
    if (!id) return;
    const fulfilled = !!target.checked;

    // Optimistic update
    if (requestsMap[id]) requestsMap[id].fulfilled = fulfilled;
    scheduleRender();

    const docRef = doc(db, "requests", id);
    updateDoc(docRef, {
      fulfilled,
      updatedAt: fbServerTimestamp(),
    }).catch((err) => {
      // Fallback for document not existing (shouldn't happen on update)
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

  // --- LIVE SYNC ---
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
});
