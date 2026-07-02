(function () {
  "use strict";

  const LINE_COLORS = {
    red: "#BF0D3E",
    orange: "#ED8B00",
    silver: "#919D9D",
    blue: "#009CDE",
    yellow: "#FFD100",
    green: "#00B140",
  };
  const LINE_ORDER = ["red", "orange", "silver", "blue", "yellow", "green"];
  const STORE_KEY = "stationreminder.v1";
  const DEFAULT_RADIUS = 500;
  const DC_CENTER = [38.8977, -77.0365];

  const $ = (id) => document.getElementById(id);
  const els = {
    main: document.querySelector("main"),
    listView: $("list-view"),
    detailView: $("detail-view"),
    search: $("search"),
    chips: $("chips"),
    list: $("station-list"),
    noResults: $("no-results"),
    progress: $("progress"),
    back: $("back"),
    name: $("detail-name"),
    dots: $("detail-dots"),
    address: $("detail-address"),
    mapOffline: $("map-offline"),
    testHint: $("test-hint"),
    radius: $("radius"),
    radiusLabel: $("radius-label"),
    coords: $("coords"),
    copy: $("copy"),
    steps: $("setup-steps"),
    altSteps: $("alt-steps-body"),
    configuredRow: $("configured-row"),
    configured: $("configured"),
    openTest: $("open-test"),
    howCard: $("how-card"),
  };

  let store = loadStore();
  let activeLine = null;
  let query = "";
  let current = null; // selected station, or {test: true, lat, lon}
  let map = null;
  let marker = null;
  let circle = null;

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && typeof raw === "object" && raw.configured) return raw;
    } catch (e) { /* corrupted storage — start fresh */ }
    return { configured: {} };
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* private mode / evicted — checklist just won't persist */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtCoords(lat, lon) {
    return lat.toFixed(6) + ", " + lon.toFixed(6);
  }

  function dotsHtml(lines) {
    return lines
      .map((l) => '<span class="dot" style="background:' + (LINE_COLORS[l] || "#999") + '" title="' + esc(l) + '"></span>')
      .join("");
  }

  // ---------- list view ----------

  function renderChips() {
    els.chips.innerHTML = "";
    LINE_ORDER.forEach((line) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(activeLine === line));
      b.innerHTML = '<span class="dot" style="background:' + LINE_COLORS[line] + '"></span>' +
        line.charAt(0).toUpperCase() + line.slice(1);
      b.addEventListener("click", () => {
        activeLine = activeLine === line ? null : line;
        renderChips();
        renderList();
      });
      els.chips.appendChild(b);
    });
  }

  function matches(st) {
    if (activeLine && !st.lines.includes(activeLine)) return false;
    if (query && !st.name.toLowerCase().includes(query)) return false;
    return true;
  }

  function renderList() {
    els.list.innerHTML = "";
    let count = 0;
    STATIONS.forEach((st) => {
      if (!matches(st)) return;
      count++;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "station-item";
      b.innerHTML =
        '<span class="name">' + esc(st.name) + "</span>" +
        '<span class="dots">' + dotsHtml(st.lines) + "</span>" +
        (store.configured[st.name] ? '<span class="check" aria-label="set up">✓</span>' : "");
      b.addEventListener("click", () => openStation(st));
      li.appendChild(b);
      els.list.appendChild(li);
    });
    els.noResults.hidden = count > 0;
  }

  function renderProgress() {
    const n = Object.keys(store.configured).length;
    els.progress.hidden = n === 0;
    els.progress.textContent =
      n + (n === 1 ? " station" : " stations") + " set up";
  }

  // ---------- map ----------

  function ensureMap() {
    if (map) return;
    // an initial view must exist before circle.getBounds()/fitBounds are legal
    map = L.map("map", { zoomSnap: 0.5 }).setView(DC_CENTER, 12);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    tiles.on("tileerror", () => {
      els.mapOffline.hidden = false;
    });
    tiles.on("load", () => {
      els.mapOffline.hidden = true;
    });
    tiles.addTo(map);
    marker = L.marker(DC_CENTER, { draggable: false }).addTo(map);
    circle = L.circle(DC_CENTER, {
      radius: DEFAULT_RADIUS,
      color: "#BF0D3E",
      weight: 2,
      fillColor: "#BF0D3E",
      fillOpacity: 0.12,
    }).addTo(map);
    map.on("click", (e) => {
      if (current && current.test) setTestPoint(e.latlng.lat, e.latlng.lng);
    });
    if ("ResizeObserver" in window) {
      // container can change size (or start at 0×0) while hidden/embedded;
      // re-measure and make sure the geofence circle is in view
      new ResizeObserver(() => {
        if (!els.detailView.hidden && map) {
          map.invalidateSize();
          fitCircle(false);
        }
      }).observe(document.getElementById("map"));
    }
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      if (current && current.test) setTestPoint(p.lat, p.lng);
    });
  }

  function fitCircle(force) {
    let b;
    let needsFit = force;
    try {
      b = circle.getBounds();
      if (!needsFit) needsFit = !map.getBounds().contains(b);
    } catch (e) {
      return; // not projectable yet; the next placeGeofence will fit
    }
    if (needsFit) map.fitBounds(b.pad(0.25), { maxZoom: 16, animate: !force });
  }

  function placeGeofence(lat, lon, radius, fit) {
    ensureMap();
    marker.setLatLng([lat, lon]);
    circle.setLatLng([lat, lon]);
    circle.setRadius(radius);
    if (fit) fitCircle(true);
  }

  // ---------- detail view ----------

  function currentRadius() {
    return parseInt(els.radius.value, 10);
  }

  function openDetail() {
    els.detailView.hidden = false;
    els.main.classList.add("split");
    ensureMap();
    // map was hidden while detail was — recompute its size next frame
    requestAnimationFrame(() => {
      map.invalidateSize();
      fitCircle(true);
    });
    els.detailView.scrollIntoView({ block: "start" });
  }

  function closeDetail() {
    current = null;
    els.detailView.hidden = true;
    els.main.classList.remove("split");
    renderList();
  }

  function openStation(st) {
    current = st;
    const saved = store.configured[st.name];
    els.radius.value = String(saved && saved.radius ? saved.radius : DEFAULT_RADIUS);
    els.name.textContent = st.name;
    els.dots.innerHTML = dotsHtml(st.lines);
    els.address.textContent = st.address || "";
    els.address.hidden = !st.address;
    els.testHint.hidden = true;
    els.configuredRow.hidden = false;
    els.configured.checked = Boolean(saved);
    marker && marker.dragging && marker.dragging.disable();
    placeGeofence(st.lat, st.lon, currentRadius(), false);
    refreshDetailText();
    openDetail();
  }

  function openTest() {
    current = { test: true, lat: DC_CENTER[0], lon: DC_CENTER[1] };
    els.radius.value = String(DEFAULT_RADIUS);
    els.name.textContent = "Practice run";
    els.dots.innerHTML = "";
    els.address.textContent =
      "Before relying on this at a real station, test the mechanism near home: tap the map to drop the pin on a spot you can walk to (a corner ~2 blocks away works well).";
    els.address.hidden = false;
    els.testHint.hidden = false;
    els.configuredRow.hidden = true;
    ensureMap();
    marker.dragging.enable();
    placeGeofence(current.lat, current.lon, currentRadius(), false);
    map.setView(DC_CENTER, 12); // zoomed out so the user can find their area
    refreshDetailText();
    openDetail();
  }

  function setTestPoint(lat, lon) {
    current.lat = lat;
    current.lon = lon;
    placeGeofence(lat, lon, currentRadius(), false);
    refreshDetailText();
  }

  function refreshDetailText() {
    if (!current) return;
    const lat = current.lat;
    const lon = current.lon;
    const r = currentRadius();
    els.radiusLabel.textContent = r + " m";
    els.coords.textContent = fmtCoords(lat, lon);
    renderSteps();
  }

  function renderSteps() {
    const isTest = Boolean(current.test);
    const name = isTest ? "Test spot" : current.name;
    const spoken = isTest ? "Arrived at your test spot" : "Approaching " + current.name + " station";
    const coords = fmtCoords(current.lat, current.lon);
    const r = currentRadius();
    const searchAlt = isTest
      ? "Or zoom the map in Shortcuts and drop the pin on the same spot."
      : "Or search “" + esc(current.name) + " Metro Station” — make sure the dropped pin matches the map preview above.";

    const steps = [
      "Open the <strong>Shortcuts</strong> app → <strong>Automation</strong> tab → <strong>+</strong>.",
      "Choose <strong>Arrive</strong>.",
      "Tap <strong>Choose</strong> under Location and paste <code>" + coords + "</code> into the search field (Copy button above). <span class=\"sub\">" + searchAlt + "</span>",
      "Drag the blue circle until it roughly matches the " + r + " m zone shown above.",
      "Leave Time at <strong>Any</strong>, select <strong>Run Immediately</strong> (not “Run After Confirmation”), then tap <strong>Next</strong>.",
      "Add two actions: <strong>Speak Text</strong> — <code>" + esc(spoken) + "</code> <span class=\"sub\">Tap Show More: pick a specific named voice (the default “Siri voice” can stay silent in automations) and turn Wait Until Finished ON.</span> Then <strong>Show Notification</strong> — <code>StationReminder: " + esc(name) + "</code>.",
      isTest
        ? "Tap <strong>Done</strong>. Now lock your phone, walk out of the circle, wait a couple of minutes, and walk back in — you should get the notification and the spoken line within about a minute of crossing. <span class=\"sub\">Delete the practice automation afterwards.</span>"
        : "Tap <strong>Done</strong>, then check “I’ve set this station up” below.",
    ];

    els.steps.innerHTML = steps.map((s) => "<li>" + s + "</li>").join("");
    els.altSteps.innerHTML =
      "In step 6, instead of Speak Text + Show Notification: add a <strong>Text</strong> action containing <code>" +
      esc(name) +
      "</code>, then <strong>Run Shortcut</strong> → <strong>StationReminder Ding</strong>, and set its input to the Text variable. The Ding shortcut plays a chime, speaks the name, and shows the notification.";
  }

  // ---------- events ----------

  els.search.addEventListener("input", () => {
    query = els.search.value.trim().toLowerCase();
    renderList();
  });

  els.back.addEventListener("click", closeDetail);
  els.openTest.addEventListener("click", openTest);

  els.radius.addEventListener("input", () => {
    if (!current) return;
    circle.setRadius(currentRadius());
    fitCircle(false);
    refreshDetailText();
    // keep the stored radius in sync for already-configured stations
    if (!current.test && store.configured[current.name]) {
      store.configured[current.name].radius = currentRadius();
      saveStore();
    }
  });

  els.configured.addEventListener("change", () => {
    if (!current || current.test) return;
    if (els.configured.checked) {
      store.configured[current.name] = { radius: currentRadius(), ts: Date.now() };
    } else {
      delete store.configured[current.name];
    }
    saveStore();
    renderProgress();
  });

  els.copy.addEventListener("click", () => {
    const text = els.coords.textContent;
    const done = () => {
      els.copy.textContent = "Copied ✓";
      els.copy.classList.add("copied");
      setTimeout(() => {
        els.copy.textContent = "Copy";
        els.copy.classList.remove("copied");
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) { /* leave button as-is */ }
    document.body.removeChild(ta);
  }

  // ---------- boot ----------

  renderChips();
  renderList();
  renderProgress();
  if (Object.keys(store.configured).length > 0) {
    els.howCard.open = false;
  }

  const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && !isLocalDev) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
