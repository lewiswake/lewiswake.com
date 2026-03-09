let DATA = [];
const JSON_FILE = "lewis_wake_mashups_database.json";
let savedScrollY = 0;

const els = {
  listView: document.getElementById("listView"),
  detailView: document.getElementById("detailView"),
  detailCard: document.getElementById("detailCard"),
  backBtn: document.getElementById("backBtn"),
  tbody: document.getElementById("tbody"),
  counts: document.getElementById("counts"),
  error: document.getElementById("error"),
  artistSearch: document.getElementById("artistSearch"),
  keySearch: document.getElementById("keySearch"),
  albumSelect: document.getElementById("albumSelect"),
  hasYoutube: document.getElementById("hasYoutube"),
  hasBandcamp: document.getElementById("hasBandcamp"),
  clearBtn: document.getElementById("clearBtn"),
  copyLink: document.getElementById("copyLink"),
  headers: document.querySelectorAll("th[data-col]"),
};

let sortCol = null;
let sortDir = 1;
let sortType = "string";

/* --- Utilities --- */
function norm(v) {
  return (v ?? "").toString().toLowerCase().trim();
}
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function splitArtists(str) {
  return (str || "")
    .toString()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function artistChipsHtml(artistStr) {
  const parts = splitArtists(artistStr);
  if (!parts.length) return "";
  return parts
    .map(
      (a) =>
        `<span class="chip artist" data-artist="${escapeHtml(
          a,
        )}">${escapeHtml(a)}</span>`,
    )
    .join(" ");
}

/* --- URL Params --- */
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    artist: p.get("artist") || "",
    key: p.get("key") || "",
    album: p.get("album") || "",
    hasVideo: p.get("hasVideo") === "1",
    hasBandcamp: p.get("hasBandcamp") === "1",
    track: p.get("track"),
  };
}

function setParams(updates, push = true) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === "" || v === false) p.delete(k);
    else p.set(k, String(v));
  }
  const url =
    window.location.pathname + (p.toString() ? "?" + p.toString() : "");
  push ? history.pushState({}, "", url) : history.replaceState({}, "", url);
}

function syncUrlFromControls(push = false) {
  setParams(
    {
      artist: els.artistSearch.value.trim(),
      key: els.keySearch.value.trim(),
      album:
        els.albumSelect.value && els.albumSelect.value !== "__ALL__"
          ? els.albumSelect.value
          : "",
      hasVideo: els.hasYoutube.checked ? 1 : "",
      hasBandcamp: els.hasBandcamp.checked ? 1 : "",
      track: "",
    },
    push,
  );
}

function initControlsFromUrl() {
  const p = getParams();
  els.artistSearch.value = p.artist;
  els.keySearch.value = p.key;
  els.hasYoutube.checked = p.hasVideo;
  els.hasBandcamp.checked = p.hasBandcamp;
  if (p.album) els.albumSelect.value = p.album;
  else els.albumSelect.value = "__ALL__";
}

/* --- Logic --- */
function matchesFilters(row) {
  const artistQ = norm(els.artistSearch.value);
  const keyQ = norm(els.keySearch.value);
  const albumQ = norm(els.albumSelect.value);

  const artistMatch =
    !artistQ ||
    norm(row["vocal artist"]).includes(artistQ) ||
    norm(row["instrumental artist"]).includes(artistQ);
  const keyMatch = !keyQ || norm(row["key"]) === keyQ;
  const albumMatch =
    !albumQ || albumQ === "__all__" || norm(row["album"]) === albumQ;

  const hasYt = !!toYouTubeLink(row["youtube"]);
  const hasBc = !!norm(row["bandcamp"]);

  if (els.hasYoutube.checked && !hasYt) return false;
  if (els.hasBandcamp.checked && !hasBc) return false;

  return artistMatch && keyMatch && albumMatch;
}

function sortRows(rows) {
  if (!sortCol || sortCol === "links") return rows;
  return [...rows].sort((a, b) => {
    let av = sortType === "number" ? num(a[sortCol]) : norm(a[sortCol]);
    let bv = sortType === "number" ? num(b[sortCol]) : norm(b[sortCol]);
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });
}

function updateSortIndicators() {
  els.headers.forEach((th) => {
    th.classList.remove("active");
    const arrow = th.querySelector(".arrow");
    if (arrow) arrow.textContent = "";
    if (th.dataset.col === sortCol) {
      th.classList.add("active");
      if (arrow) arrow.textContent = sortDir === 1 ? "▲" : "▼";
    }
  });
}

function normalizeYouTube(value) {
  const v = (value || "").toString().trim();
  if (!v) return { id: "", url: "" };
  if (/^[A-Za-z0-9_-]{11}$/.test(v))
    return { id: v, url: `https://youtu.be/${v}` };

  try {
    const parsed = new URL(v);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(id))
        return { id, url: `https://youtu.be/${id}` };
    }
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v") || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(id))
        return { id, url: `https://youtu.be/${id}` };
      const parts = parsed.pathname.split("/").filter(Boolean);
      if ((parts[0] === "shorts" || parts[0] === "embed") && parts[1]) {
        return { id: parts[1], url: `https://youtu.be/${parts[1]}` };
      }
    }
  } catch {}
  return { id: "", url: v };
}

function toYouTubeLink(value) {
  return normalizeYouTube(value).url || "";
}
function toYouTubeEmbed(value) {
  const id = normalizeYouTube(value).id;
  return id ? `https://www.youtube.com/embed/${id}` : "";
}

function populateAlbums() {
  const set = new Set();
  DATA.forEach((r) => {
    const a = (r["album"] || "").toString().trim();
    if (a) set.add(a);
  });
  const albums = Array.from(set).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

  els.albumSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "__ALL__";
  optAll.textContent = "All Albums";
  els.albumSelect.appendChild(optAll);

  albums.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    els.albumSelect.appendChild(opt);
  });
  const p = getParams();
  if (p.album) els.albumSelect.value = p.album;
}

/* --- RENDER --- */
function renderList() {
  const filtered = DATA.filter(matchesFilters);
  const rows = sortRows(filtered);

  els.tbody.innerHTML = "";
  els.counts.textContent = `${rows.length.toLocaleString()} / ${DATA.length.toLocaleString()} mashups`;

  if (rows.length === 0) {
    els.tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px; color: var(--text-secondary);">No mashups found matching those filters.</td></tr>`;
    updateSortIndicators();
    return;
  }

  const frag = document.createDocumentFragment();

  rows.forEach((r) => {
    const idx = r.__idx;
    const ytLink = toYouTubeLink(r.youtube);
    const bc = (r.bandcamp || "").trim();

    const linksHtml =
      '<div style="display:flex; gap:10px;">' +
      (ytLink
        ? `<a class="iconlink" href="${escapeHtml(
            ytLink,
          )}" target="_blank">▶️ YT</a>`
        : "") +
      (bc
        ? `<a class="iconlink" href="${escapeHtml(
            bc,
          )}" target="_blank">🅱️ BC</a>`
        : "") +
      (!ytLink && !bc ? `<span style="opacity:0.3">—</span>` : "") +
      "</div>";

    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><a class="rowlink" href="javascript:void(0)" data-track="${idx}">${escapeHtml(
        r["track title"],
      )}</a></td>` +
      `<td>${
        r["vocal artist"] ? artistChipsHtml(r["vocal artist"]) : "—"
      }</td>` +
      `<td>${
        r["instrumental artist"]
          ? artistChipsHtml(r["instrumental artist"])
          : "—"
      }</td>` +
      `<td>${escapeHtml(r["year"])}</td>` +
      `<td>${escapeHtml(r["bpm"])}</td>` +
      `<td>${
        r["key"]
          ? `<span class="chip key" data-key="${escapeHtml(
              r["key"],
            )}">${escapeHtml(r["key"])}</span>`
          : "—"
      }</td>` +
      `<td>${escapeHtml(r["album"])}</td>` +
      `<td>${linksHtml}</td>`;
    frag.appendChild(tr);
  });
  els.tbody.appendChild(frag);
  updateSortIndicators();
}

function showDetailView(indexStr) {
  const idx = parseInt(indexStr, 10);
  const row = DATA.find((r) => r.__idx === idx);
  if (!row) {
    showListView();
    renderList();
    return;
  }

  savedScrollY = window.scrollY;

  const ytEmbed = toYouTubeEmbed(row.youtube);
  const bc = (row.bandcamp || "").trim();
  const ytLink = toYouTubeLink(row.youtube);

  const chips =
    '<div style="margin-top:16px">' +
    (row["vocal artist"] ? artistChipsHtml(row["vocal artist"]) : "") +
    (row["instrumental artist"]
      ? artistChipsHtml(row["instrumental artist"])
      : "") +
    (row["key"]
      ? `<span class="chip key" data-key="${escapeHtml(
          row["key"],
        )}">${escapeHtml(row["key"])}</span>`
      : "") +
    "</div>";

  const ytSection = ytEmbed
    ? `<div class="embed-container"><iframe src="${escapeHtml(
        ytEmbed,
      )}" width="100%" height="400" frameborder="0" allowfullscreen></iframe></div>`
    : "";

  const bcSection =
    bc.includes("<iframe") && bc.includes("bandcamp.com")
      ? `<div class="embed-container" style="background:transparent; box-shadow:none;">${bc}</div>`
      : "";

  const extLinks =
    `<div style="margin-top:24px; display:flex; gap:12px">` +
    (ytLink
      ? `<a href="${ytLink}" target="_blank" class="pill-btn">Watch on YouTube</a>`
      : "") +
    (bc && !bc.includes("<iframe")
      ? `<a href="${bc}" target="_blank" class="pill-btn">Listen on Bandcamp</a>`
      : "") +
    `</div>`;

  els.detailCard.innerHTML =
    `<h2 style="font-size:2.5rem; line-height:1.1; margin-bottom:0;">${escapeHtml(
      row["track title"],
    )}</h2>` +
    chips +
    '<div class="kv-grid">' +
    `<div class="k">Album</div><div>${escapeHtml(row["album"]) || "—"}</div>` +
    `<div class="k">Year</div><div>${escapeHtml(row["year"]) || "—"}</div>` +
    `<div class="k">BPM</div><div>${escapeHtml(row["bpm"]) || "—"}</div>` +
    `<div class="k">Time</div><div>${escapeHtml(row["time"]) || "—"}</div>` +
    "</div>" +
    extLinks +
    ytSection +
    bcSection;

  els.listView.classList.remove("active");
  els.detailView.classList.add("active");
  window.scrollTo(0, 0);
}

function showListView() {
  els.detailView.classList.remove("active");
  els.listView.classList.add("active");
  window.scrollTo(0, savedScrollY);
}

function route() {
  initControlsFromUrl();
  const p = getParams();
  if (p.track !== null && p.track !== undefined && p.track !== "")
    showDetailView(p.track);
  else {
    showListView();
    renderList();
  }
}

/* --- Events --- */
els.headers.forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    const type = th.dataset.type;
    if (sortCol === col) sortDir *= -1;
    else {
      sortCol = col;
      sortType = type;
      sortDir = 1;
    }
    if (els.listView.classList.contains("active")) renderList();
  });
});

els.tbody.addEventListener("click", (e) => {
  const chipArtist = e.target.closest(".chip.artist");
  const chipKey = e.target.closest(".chip.key");
  const trackLink = e.target.closest("[data-track]");

  if (chipArtist) {
    els.artistSearch.value = chipArtist.dataset.artist;
    syncUrlFromControls(false);
    renderList();
    return;
  }
  if (chipKey) {
    els.keySearch.value = chipKey.dataset.key;
    syncUrlFromControls(false);
    renderList();
    return;
  }
  if (trackLink) {
    setParams({ track: trackLink.dataset.track }, true);
    route();
    return;
  }
});

els.detailCard.addEventListener("click", (e) => {
  const chipArtist = e.target.closest(".chip.artist");
  const chipKey = e.target.closest(".chip.key");
  if (chipArtist) {
    els.artistSearch.value = chipArtist.dataset.artist;
    els.keySearch.value = "";
    els.albumSelect.value = "__ALL__";
    els.hasYoutube.checked = false;
    els.hasBandcamp.checked = false;
    setParams(
      {
        artist: els.artistSearch.value,
        key: "",
        album: "",
        hasVideo: "",
        hasBandcamp: "",
        track: "",
      },
      true,
    );
    route();
  }
  if (chipKey) {
    els.keySearch.value = chipKey.dataset.key;
    setParams({ key: els.keySearch.value, track: "" }, true);
    route();
  }
});

function hook(el, evt) {
  el.addEventListener(evt, () => {
    syncUrlFromControls(false);
    renderList();
  });
}
hook(els.artistSearch, "input");
hook(els.keySearch, "input");
hook(els.albumSelect, "change");
hook(els.hasYoutube, "change");
hook(els.hasBandcamp, "change");

els.clearBtn.addEventListener("click", () => {
  els.artistSearch.value = "";
  els.keySearch.value = "";
  els.albumSelect.value = "__ALL__";
  els.hasYoutube.checked = false;
  els.hasBandcamp.checked = false;
  syncUrlFromControls(true);
  renderList();
});

els.backBtn.addEventListener("click", () => {
  setParams({ track: "" }, true);
  route();
});

els.copyLink.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const orig = els.copyLink.textContent;
    els.copyLink.textContent = "Copied!";
    setTimeout(() => (els.copyLink.textContent = orig), 1500);
  } catch {}
});

window.addEventListener("popstate", route);

/* --- INIT --- */
async function loadData() {
  els.error.style.display = "none";
  try {
    const res = await fetch(JSON_FILE, { cache: "no-store" });
    if (!res.ok) throw new Error("Fetch Error");
    DATA = await res.json();
    DATA = DATA.map((r, i) => ({ ...r, __idx: i }));
    populateAlbums();
    route();
  } catch (err) {
    els.counts.textContent = "—";
    els.error.style.display = "block";
    els.error.innerHTML =
      "Error loading database file. Ensure you are running on localhost.";
  }
}
loadData();
