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
  const BUS_COLOR = "#0071bc";
  const SELECT_COLOR = "#BF0D3E";
  const DONE_COLOR = "#00B140";
  const STORE_KEY = "stationreminder.v2";
  const OLD_STORE_KEY = "stationreminder.v1";
  const DEFAULT_RADIUS = { rail: 500, bus: 300, test: 500 };
  const WINDOW_PRESETS = { am: ["06:00", "10:00"], pm: ["15:00", "19:00"] };
  const DC_CENTER = [38.895, -77.0365];
  const REGION_VIEW = { center: [38.9, -77.06], zoom: 10 };
  const BUS_ZOOM_MIN = 16;
  const MAX_VIEWPORT_STOPS = 400;
  const MAX_SELECTION = 12;

  const $ = (id) => document.getElementById(id);
  const els = {
    progress: $("progress"),
    pickerView: $("picker-view"),
    wizardView: $("wizard-view"),
    tabRail: $("tab-rail"),
    tabBus: $("tab-bus"),
    railControls: $("rail-controls"),
    busControls: $("bus-controls"),
    railSearch: $("rail-search"),
    railDrop: $("rail-drop"),
    busSearch: $("bus-search"),
    busDrop: $("bus-drop"),
    busRouteChips: $("bus-route-chips"),
    busHint: $("bus-hint"),
    sideList: $("side-list"),
    chips: $("chips"),
    pickerOffline: $("picker-offline"),
    tray: $("tray"),
    trayChips: $("tray-chips"),
    trayGo: $("tray-go"),
    howCard: $("how-card"),
    openTest: $("open-test"),
    configuredCard: $("configured-card"),
    configuredCount: $("configured-count"),
    configuredList: $("configured-list"),
    wizardBack: $("wizard-back"),
    wizardProgress: $("wizard-progress"),
    detailKind: $("detail-kind"),
    detailName: $("detail-name"),
    detailDots: $("detail-dots"),
    detailAddress: $("detail-address"),
    mapOffline: $("map-offline"),
    testHint: $("test-hint"),
    radius: $("radius"),
    radiusLabel: $("radius-label"),
    windowSeg: $("window-seg"),
    windowCustom: $("window-custom"),
    winStart: $("win-start"),
    winEnd: $("win-end"),
    coords: $("coords"),
    copy: $("copy"),
    steps: $("setup-steps"),
    altSteps: $("alt-steps-body"),
    configuredRow: $("configured-row"),
    configured: $("configured"),
    wizardNav: $("wizard-nav"),
    wizPrev: $("wiz-prev"),
    wizNext: $("wiz-next"),
  };

  // ---------------- state ----------------
  let store = loadStore();
  let tab = "rail";
  let activeLine = null;
  let railQuery = "";
  let activeRouteIdx = null;
  let busData = null; // { routes: [...], stops: [{id,name,lat,lon,routes}] }
  let busLoading = false;
  let selection = []; // [{kind,key,name,lat,lon,lines?,address?,routes?}]
  let wizardItems = [];
  let wizardIdx = 0;
  let currentWin = null; // null | ["HH:MM","HH:MM"]

  // picker map
  let pMap = null;
  let railLineLayers = {};
  let stationMarkers = {}; // name -> circleMarker
  let busRouteLayer = null;
  let busStopLayer = null;
  let busMarkers = {}; // stopId -> circleMarker (currently rendered only)
  let canvasRenderer = null;

  // detail map
  let dMap = null;
  let dMarker = null;
  let dCircle = null;

  // ---------------- storage ----------------
  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && typeof raw === "object" && raw.configured) return raw;
    } catch (e) { /* fall through */ }
    // migrate v1 {configured: {stationName: {radius, ts}}}
    const migrated = { configured: {} };
    try {
      const old = JSON.parse(localStorage.getItem(OLD_STORE_KEY));
      if (old && old.configured && typeof STATIONS !== "undefined") {
        Object.keys(old.configured).forEach((name) => {
          const st = STATIONS.find((s) => s.name === name);
          if (!st) return;
          migrated.configured["rail:" + name] = {
            kind: "rail",
            name: name,
            lat: st.lat,
            lon: st.lon,
            radius: old.configured[name].radius || DEFAULT_RADIUS.rail,
            win: null,
            ts: old.configured[name].ts || 0,
          };
        });
      }
    } catch (e) { /* no v1 data */ }
    return migrated;
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* private mode — checklist won't persist */ }
  }

  function keyFor(item) {
    if (item.kind === "rail") return "rail:" + item.name;
    if (item.kind === "bus") return "bus:" + item.id;
    return null; // test
  }

  function isConfigured(item) {
    const k = keyFor(item);
    return k ? Boolean(store.configured[k]) : false;
  }

  // ---------------- small helpers ----------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtCoords(lat, lon) {
    return lat.toFixed(6) + ", " + lon.toFixed(6);
  }

  function fmtTime12(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return hhmm || "";
    let h = parseInt(m[1], 10);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + m[2] + " " + ap;
  }

  function winLabel(win) {
    return win ? fmtTime12(win[0]) + "–" + fmtTime12(win[1]) : "Any time";
  }

  function speakable(item) {
    if (item.kind === "rail") return "Approaching " + item.name + " station";
    if (item.kind === "bus") return "Approaching " + item.name.replace(/\+/g, " and ") + " bus stop";
    return "Arrived at your test spot";
  }

  function dotsHtml(lines) {
    return (lines || [])
      .map((l) => '<span class="dot" style="background:' + (LINE_COLORS[l] || "#999") + '" title="' + esc(l) + '"></span>')
      .join("");
  }

  function railItem(st) {
    return { kind: "rail", name: st.name, lat: st.lat, lon: st.lon, lines: st.lines, address: st.address };
  }

  function busItem(stop) {
    return { kind: "bus", id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, routes: stop.routes };
  }

  // ---------------- header / configured card ----------------
  function renderProgress() {
    const n = Object.keys(store.configured).length;
    els.progress.hidden = n === 0;
    els.progress.textContent = n + (n === 1 ? " reminder" : " reminders") + " set up";
  }

  function renderConfiguredCard() {
    const entries = Object.entries(store.configured).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    els.configuredCard.hidden = entries.length === 0;
    els.configuredCount.textContent = String(entries.length);
    els.configuredList.innerHTML = "";
    entries.forEach(([key, e]) => {
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="cfg-kind">' + (e.kind === "bus" ? "🚌" : "🚇") + "</span>" +
        '<span class="cfg-main"><span class="cfg-name">' + esc(e.name) + "</span>" +
        '<span class="cfg-meta">' + e.radius + " m · " + esc(winLabel(e.win)) + "</span></span>";
      const edit = document.createElement("button");
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        const item = { kind: e.kind, id: key.slice(4), name: e.name, lat: e.lat, lon: e.lon, lines: e.lines };
        if (e.kind === "rail") {
          const st = (typeof STATIONS !== "undefined") && STATIONS.find((s) => s.name === e.name);
          if (st) { item.lines = st.lines; item.address = st.address; }
        }
        startWizard([item]);
      });
      const rm = document.createElement("button");
      rm.className = "cfg-remove";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => {
        delete store.configured[key];
        saveStore();
        renderProgress();
        renderConfiguredCard();
        restyleAllMarkers();
      });
      li.appendChild(edit);
      li.appendChild(rm);
      els.configuredList.appendChild(li);
    });
  }

  // ---------------- picker map ----------------
  function ensurePickerMap() {
    if (pMap) return;
    pMap = L.map("picker-map", { zoomSnap: 0.5 }).setView(REGION_VIEW.center, REGION_VIEW.zoom);
    canvasRenderer = L.canvas({ padding: 0.3 });
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    tiles.on("tileerror", () => { els.pickerOffline.hidden = false; });
    tiles.on("load", () => { els.pickerOffline.hidden = true; });
    tiles.addTo(pMap);

    // rail lines
    Object.keys(RAIL_LINES).forEach((line) => {
      railLineLayers[line] = L.layerGroup(
        RAIL_LINES[line].map((path) =>
          L.polyline(path, { color: LINE_COLORS[line], weight: 4, opacity: 0.8, interactive: false })
        )
      ).addTo(pMap);
    });

    // rail stations
    STATIONS.forEach((st) => {
      const mk = L.circleMarker([st.lat, st.lon], railMarkerStyle(st));
      mk.bindTooltip(st.name, { direction: "top", offset: [0, -6] });
      mk.on("click", () => toggleSelect(railItem(st)));
      mk.addTo(pMap);
      stationMarkers[st.name] = mk;
    });

    busRouteLayer = L.layerGroup();
    busStopLayer = L.layerGroup();

    pMap.on("moveend", () => {
      if (tab === "bus" && activeRouteIdx === null) renderBusStops();
    });
    pMap.on("zoomend", () => {
      if (tab === "bus") renderBusStops(); // dot size is zoom-dependent
    });

    if ("ResizeObserver" in window) {
      new ResizeObserver(() => { if (pMap) pMap.invalidateSize(); })
        .observe(document.getElementById("picker-map"));
    }
  }

  function railMarkerStyle(st) {
    const item = railItem(st);
    const sel = selection.some((s) => s.key === keyFor(item) || (s.kind === "rail" && s.name === st.name));
    const done = isConfigured(item);
    const ring = st.lines.length === 1 ? LINE_COLORS[st.lines[0]] : "#3a3a3c";
    const dimmed = activeLine && !st.lines.includes(activeLine);
    return {
      radius: sel ? 9 : 6.5,
      color: sel ? SELECT_COLOR : done ? DONE_COLOR : ring,
      weight: sel || done ? 3 : 2,
      fillColor: sel ? SELECT_COLOR : done ? DONE_COLOR : "#ffffff",
      fillOpacity: 1,
      opacity: dimmed ? 0.25 : 1,
      pane: "markerPane",
    };
  }

  function busMarkerStyle(stop) {
    const item = busItem(stop);
    const sel = selection.some((s) => s.kind === "bus" && s.id === stop.id);
    const done = isConfigured(item);
    const z = pMap ? pMap.getZoom() : 15;
    const base = z >= 15 ? 5.5 : z >= 13 ? 4 : 2.8; // dense routes stay readable zoomed out
    return {
      renderer: canvasRenderer,
      radius: sel ? base + 2.5 : base,
      color: sel ? SELECT_COLOR : done ? DONE_COLOR : BUS_COLOR,
      weight: z >= 13 ? 2 : 1.5,
      fillColor: sel ? SELECT_COLOR : done ? DONE_COLOR : "#ffffff",
      fillOpacity: 1,
      pane: "markerPane",
    };
  }

  function restyleAllMarkers() {
    STATIONS.forEach((st) => {
      const mk = stationMarkers[st.name];
      if (mk) mk.setStyle(railMarkerStyle(st));
    });
    Object.keys(busMarkers).forEach((id) => {
      const stop = busData && busData.stopById[id];
      if (stop && busMarkers[id]) busMarkers[id].setStyle(busMarkerStyle(stop));
    });
    renderSideList(); // selection/configured state shows in the side list too
  }

  function highlightLine(line) {
    activeLine = line;
    Object.keys(railLineLayers).forEach((l) => {
      railLineLayers[l].eachLayer((pl) =>
        pl.setStyle({
          opacity: !line || l === line ? (l === line ? 1 : 0.8) : 0.18,
          weight: l === line ? 6 : 4,
        })
      );
    });
    restyleAllMarkers();
    renderLineChips();
    if (line) {
      const group = L.featureGroup();
      RAIL_LINES[line].forEach((path) => group.addLayer(L.polyline(path)));
      // rAF so a mid-relayout (rotation/resize) container doesn't produce a bogus zoom
      requestAnimationFrame(() => {
        pMap.invalidateSize();
        pMap.fitBounds(group.getBounds().pad(0.08));
      });
    }
  }

  function renderLineChips() {
    els.chips.innerHTML = "";
    LINE_ORDER.forEach((line) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(activeLine === line));
      b.innerHTML = '<span class="dot" style="background:' + LINE_COLORS[line] + '"></span>' +
        line.charAt(0).toUpperCase() + line.slice(1);
      b.addEventListener("click", () => highlightLine(activeLine === line ? null : line));
      els.chips.appendChild(b);
    });
  }

  // ---------------- bus data + layers ----------------
  function loadBusData() {
    if (busData || busLoading) return;
    busLoading = true;
    els.busHint.textContent = "Loading bus network…";
    fetch("./data/bus.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((raw) => {
        const stops = raw.stops.map((s) => ({ id: String(s[0]), name: s[1], lat: s[2], lon: s[3], routes: s[4] }));
        const stopById = {};
        stops.forEach((s) => { stopById[s.id] = s; });
        busData = { routes: raw.routes, stops: stops, stopById: stopById };
        busLoading = false;
        defaultBusHint();
        if (tab === "bus") { renderBusStops(); renderSideList(); }
      })
      .catch(() => {
        busLoading = false;
        els.busHint.textContent = "Couldn’t load the bus network — check your connection and switch tabs to retry.";
        busData = null;
      });
  }

  function defaultBusHint() {
    els.busHint.textContent =
      "Pick a route to draw it with its stops — or zoom the map in to see all stops around you. Tap stops to select.";
  }

  function selectRoute(idx) {
    activeRouteIdx = idx;
    busRouteLayer.clearLayers();
    if (idx !== null && busData) {
      const r = busData.routes[idx];
      const group = L.featureGroup();
      r.paths.forEach((path) => {
        const pl = L.polyline(path, { color: BUS_COLOR, weight: 4, opacity: 0.85, interactive: false });
        busRouteLayer.addLayer(pl);
        group.addLayer(L.polyline(path));
      });
      pMap.fitBounds(group.getBounds().pad(0.08));
      els.busHint.textContent = r.id + " · " + (r.desc || "") + (r.via ? " · " + r.via : "") + " — tap stops to select.";
    } else if (busData) {
      defaultBusHint();
    }
    renderBusRouteChips();
    renderBusStops();
    renderSideList();
  }

  function renderBusRouteChips(matches) {
    els.busRouteChips.innerHTML = "";
    if (!busData) return;
    let idxs = matches;
    if (!idxs) idxs = activeRouteIdx !== null ? [activeRouteIdx] : [];
    idxs.slice(0, 10).forEach((i) => {
      const r = busData.routes[i];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(i === activeRouteIdx));
      b.innerHTML = '<span class="dot" style="background:' + BUS_COLOR + '"></span>' + esc(r.id);
      b.title = (r.desc || "") + (r.via ? " — " + r.via : "");
      b.addEventListener("click", () => selectRoute(i === activeRouteIdx ? null : i));
      els.busRouteChips.appendChild(b);
    });
  }

  function renderBusStops() {
    if (!busData || !pMap) return;
    busStopLayer.clearLayers();
    busMarkers = {};
    let stops = [];
    if (activeRouteIdx !== null) {
      stops = busData.stops.filter((s) => s.routes.includes(activeRouteIdx));
    } else if (pMap.getZoom() >= BUS_ZOOM_MIN) {
      const b = pMap.getBounds().pad(0.1);
      for (const s of busData.stops) {
        if (b.contains([s.lat, s.lon])) {
          stops.push(s);
          if (stops.length >= MAX_VIEWPORT_STOPS) break;
        }
      }
    } else {
      // ensure selected-but-offscreen styling still resolves next render
      stops = busData.stops.filter((s) => selection.some((x) => x.kind === "bus" && x.id === s.id));
    }
    stops.forEach((s) => {
      const mk = L.circleMarker([s.lat, s.lon], busMarkerStyle(s));
      mk.bindTooltip(s.name.replace(/\+/g, " @ "), { direction: "top", offset: [0, -6] });
      mk.on("click", () => toggleSelect(busItem(s)));
      busStopLayer.addLayer(mk);
      busMarkers[s.id] = mk;
    });
  }

  // ---------------- side list (wide screens) ----------------
  function renderSideList() {
    const ul = els.sideList;
    ul.innerHTML = "";
    const addEmpty = (msg) => {
      const li = document.createElement("li");
      li.className = "side-empty";
      li.textContent = msg;
      ul.appendChild(li);
    };
    const addRow = (label, trailingHtml, item, zoomTo) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "side-item";
      b.setAttribute("aria-pressed", String(selection.some((s) => s.key === keyFor(item))));
      b.innerHTML =
        '<span class="name">' + esc(label) + "</span>" + trailingHtml +
        (isConfigured(item) ? '<span class="check">✓</span>' : "");
      b.addEventListener("click", () => {
        toggleSelect(item);
        if (pMap.getZoom() < zoomTo) pMap.flyTo([item.lat, item.lon], zoomTo, { duration: 0.6 });
        else pMap.panTo([item.lat, item.lon]);
      });
      li.appendChild(b);
      ul.appendChild(li);
    };

    if (tab === "rail") {
      const list = STATIONS.filter((st) =>
        (!activeLine || st.lines.includes(activeLine)) &&
        (!railQuery || st.name.toLowerCase().includes(railQuery))
      );
      if (!list.length) { addEmpty("No stations match."); return; }
      list.forEach((st) =>
        addRow(st.name, '<span class="dots">' + dotsHtml(st.lines) + "</span>", railItem(st), 13)
      );
    } else {
      if (!busData) { addEmpty(busLoading ? "Loading bus network…" : "Bus network unavailable."); return; }
      if (activeRouteIdx === null) { addEmpty("Pick a route above to list its stops here — or tap them on the map."); return; }
      busData.stops
        .filter((s) => s.routes.includes(activeRouteIdx))
        .forEach((s) => addRow(s.name.replace(/\+/g, " @ "), "", busItem(s), 15));
    }
  }

  // ---------------- search ----------------
  function wireSearch(input, dropEl, getMatches, onPick) {
    function close() { dropEl.hidden = true; dropEl.innerHTML = ""; }
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { close(); if (tab === "bus") renderBusRouteChips(); return; }
      const matches = getMatches(q);
      dropEl.innerHTML = "";
      matches.slice(0, 7).forEach((m) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = m.html;
        b.addEventListener("click", () => { close(); onPick(m); });
        li.appendChild(b);
        dropEl.appendChild(li);
      });
      dropEl.hidden = matches.length === 0;
    });
    input.addEventListener("blur", () => setTimeout(close, 200));
  }

  function pulseMarker(mk) {
    if (!mk) return;
    const el = mk.getElement && mk.getElement();
    if (el) {
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 2200);
    }
    if (mk.openTooltip) mk.openTooltip();
  }

  function setupRailSearch() {
    wireSearch(
      els.railSearch,
      els.railDrop,
      (q) => STATIONS
        .filter((st) => st.name.toLowerCase().includes(q))
        .map((st) => ({
          st: st,
          html: esc(st.name) + '<span class="sub">' + dotsHtml(st.lines) + "</span>",
        })),
      (m) => {
        pMap.flyTo([m.st.lat, m.st.lon], 15, { duration: 0.8 });
        setTimeout(() => pulseMarker(stationMarkers[m.st.name]), 900);
      }
    );
  }

  function setupBusSearch() {
    wireSearch(
      els.busSearch,
      els.busDrop,
      (q) => {
        if (!busData) return [];
        const routeIdxs = [];
        busData.routes.forEach((r, i) => {
          if (r.id.toLowerCase().startsWith(q) || (r.desc || "").toLowerCase().includes(q)) routeIdxs.push(i);
        });
        renderBusRouteChips(routeIdxs);
        return busData.stops
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, 7)
          .map((s) => ({
            stop: s,
            html: esc(s.name.replace(/\+/g, " @ ")) +
              '<span class="sub">' + s.routes.slice(0, 4).map((ri) => esc(busData.routes[ri].id)).join(" ") + "</span>",
          }));
      },
      (m) => {
        selectRoute(null);
        pMap.flyTo([m.stop.lat, m.stop.lon], 17, { duration: 0.8 });
        setTimeout(() => { renderBusStops(); pulseMarker(busMarkers[m.stop.id]); }, 900);
      }
    );
  }

  // ---------------- selection + tray ----------------
  function toggleSelect(item) {
    item.key = keyFor(item);
    const i = selection.findIndex((s) => s.key === item.key);
    if (i >= 0) {
      selection.splice(i, 1);
    } else {
      if (selection.length >= MAX_SELECTION) {
        els.busHint.textContent = "That’s plenty for one batch — iOS shares ~20 geofences across ALL automations.";
        return;
      }
      selection.push(item);
    }
    restyleAllMarkers();
    renderTray();
  }

  function renderTray() {
    els.tray.hidden = selection.length === 0;
    els.trayChips.innerHTML = "";
    selection.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "tray-chip";
      chip.innerHTML = (item.kind === "bus" ? "🚌 " : "🚇 ") + esc(shortName(item));
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "✕";
      x.setAttribute("aria-label", "Remove " + item.name);
      x.addEventListener("click", () => toggleSelect(item));
      chip.appendChild(x);
      els.trayChips.appendChild(chip);
    });
    els.trayGo.textContent = "Set up " + (selection.length > 1 ? selection.length + " reminders →" : "→");
  }

  function shortName(item) {
    const n = item.name.replace(/\+/g, " @ ");
    return n.length > 22 ? n.slice(0, 21) + "…" : n;
  }

  // ---------------- detail (wizard) map ----------------
  function ensureDetailMap() {
    if (dMap) return;
    dMap = L.map("map", { zoomSnap: 0.5 }).setView(DC_CENTER, 12);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    tiles.on("tileerror", () => { els.mapOffline.hidden = false; });
    tiles.on("load", () => { els.mapOffline.hidden = true; });
    tiles.addTo(dMap);
    dMarker = L.marker(DC_CENTER, { draggable: false }).addTo(dMap);
    dCircle = L.circle(DC_CENTER, {
      radius: DEFAULT_RADIUS.rail,
      color: SELECT_COLOR,
      weight: 2,
      fillColor: SELECT_COLOR,
      fillOpacity: 0.12,
    }).addTo(dMap);
    dMap.on("click", (e) => {
      const item = wizardItems[wizardIdx];
      if (item && item.kind === "test") setTestPoint(e.latlng.lat, e.latlng.lng);
    });
    dMarker.on("dragend", () => {
      const item = wizardItems[wizardIdx];
      const p = dMarker.getLatLng();
      if (item && item.kind === "test") setTestPoint(p.lat, p.lng);
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (!els.wizardView.hidden && dMap) {
          dMap.invalidateSize();
          fitCircle(false);
        }
      }).observe(document.getElementById("map"));
    }
  }

  function fitCircle(force) {
    let b;
    let needsFit = force;
    try {
      b = dCircle.getBounds();
      if (!needsFit) needsFit = !dMap.getBounds().contains(b);
    } catch (e) {
      return;
    }
    if (needsFit) dMap.fitBounds(b.pad(0.25), { maxZoom: 16, animate: !force });
  }

  function placeGeofence(lat, lon, radius) {
    ensureDetailMap();
    dMarker.setLatLng([lat, lon]);
    dCircle.setLatLng([lat, lon]);
    dCircle.setRadius(radius);
  }

  function setTestPoint(lat, lon) {
    const item = wizardItems[wizardIdx];
    item.lat = lat;
    item.lon = lon;
    placeGeofence(lat, lon, currentRadius());
    refreshDetailText();
  }

  // ---------------- wizard ----------------
  function currentRadius() {
    return parseInt(els.radius.value, 10);
  }

  function setWindowUI(win) {
    currentWin = win;
    let mode = "any";
    if (win) {
      if (win[0] === WINDOW_PRESETS.am[0] && win[1] === WINDOW_PRESETS.am[1]) mode = "am";
      else if (win[0] === WINDOW_PRESETS.pm[0] && win[1] === WINDOW_PRESETS.pm[1]) mode = "pm";
      else mode = "custom";
    }
    els.windowSeg.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.win === mode))
    );
    els.windowCustom.hidden = mode !== "custom";
    if (win) {
      els.winStart.value = win[0];
      els.winEnd.value = win[1];
    }
  }

  function startWizard(items) {
    wizardItems = items;
    wizardIdx = 0;
    els.pickerView.hidden = true;
    els.wizardView.hidden = false;
    els.tray.hidden = true;
    renderWizardStep();
    window.scrollTo({ top: 0 });
  }

  function exitWizard() {
    els.wizardView.hidden = true;
    els.pickerView.hidden = false;
    renderTray();
    restyleAllMarkers();
    renderConfiguredCard();
    if (pMap) requestAnimationFrame(() => pMap.invalidateSize());
  }

  function renderWizardStep() {
    const item = wizardItems[wizardIdx];
    const isTest = item.kind === "test";
    const saved = keyFor(item) ? store.configured[keyFor(item)] : null;

    els.wizardProgress.hidden = wizardItems.length < 2;
    els.wizardProgress.textContent = "Reminder " + (wizardIdx + 1) + " of " + wizardItems.length;

    els.detailKind.textContent = item.kind === "bus" ? "BUS STOP" : isTest ? "PRACTICE" : "STATION";
    els.detailKind.className = "kind-badge" + (item.kind === "bus" ? " bus" : "");
    els.detailName.textContent = isTest ? "Practice run" : item.name.replace(/\+/g, " @ ");
    els.detailDots.innerHTML = item.kind === "rail" ? dotsHtml(item.lines) : "";

    if (isTest) {
      els.detailAddress.textContent =
        "Test the mechanism near home first: tap the map to drop the pin on a spot you can walk to (a corner ~2 blocks away works well).";
      els.detailAddress.hidden = false;
    } else if (item.kind === "bus") {
      const routes = (item.routes || []).map((ri) => busData ? busData.routes[ri].id : null).filter(Boolean);
      els.detailAddress.textContent = routes.length ? "Routes: " + routes.join(", ") : "";
      els.detailAddress.hidden = routes.length === 0;
    } else {
      els.detailAddress.textContent = item.address || "";
      els.detailAddress.hidden = !item.address;
    }

    els.testHint.hidden = !isTest;
    els.configuredRow.hidden = isTest;
    els.configured.checked = Boolean(saved);
    els.radius.value = String(saved && saved.radius ? saved.radius : DEFAULT_RADIUS[item.kind] || 500);
    setWindowUI(saved ? saved.win : null);

    ensureDetailMap();
    if (dMarker.dragging) {
      if (isTest) dMarker.dragging.enable();
      else dMarker.dragging.disable();
    }
    placeGeofence(item.lat, item.lon, currentRadius());
    if (isTest) dMap.setView([item.lat, item.lon], 12);

    els.wizardNav.hidden = wizardItems.length < 2;
    els.wizPrev.disabled = wizardIdx === 0;
    els.wizNext.textContent = wizardIdx === wizardItems.length - 1 ? "Done ✓" : "Next ›";

    refreshDetailText();
    requestAnimationFrame(() => {
      dMap.invalidateSize();
      fitCircle(true);
    });
  }

  function refreshDetailText() {
    const item = wizardItems[wizardIdx];
    if (!item) return;
    els.radiusLabel.textContent = currentRadius() + " m";
    els.coords.textContent = fmtCoords(item.lat, item.lon);
    renderSteps(item);
  }

  function renderSteps(item) {
    const isTest = item.kind === "test";
    const displayName = isTest ? "Test spot" : item.name.replace(/\+/g, " @ ");
    const coords = fmtCoords(item.lat, item.lon);
    const r = currentRadius();
    const win = currentWin;

    let locateAlt;
    if (item.kind === "rail") {
      locateAlt = "Or search “" + esc(item.name) + " Metro Station” — make sure the dropped pin matches the map preview above.";
    } else if (item.kind === "bus") {
      locateAlt = "Bus stops usually aren’t searchable in Maps — pasting the coordinates is the reliable way. Confirm the pin lands on “" + esc(displayName) + "”.";
    } else {
      locateAlt = "Or zoom the map in Shortcuts and drop the pin on the same spot.";
    }

    const timeStep = win
      ? "Under Time, choose <strong>Time Range</strong> and enter <code>" + esc(fmtTime12(win[0])) + "</code> to <code>" + esc(fmtTime12(win[1])) + "</code>. Select <strong>Run Immediately</strong> (not “Run After Confirmation”), then tap <strong>Next</strong>."
      : "Leave Time at <strong>Any</strong>, select <strong>Run Immediately</strong> (not “Run After Confirmation”), then tap <strong>Next</strong>.";

    const steps = [
      "Open the <strong>Shortcuts</strong> app → <strong>Automation</strong> tab → <strong>+</strong>.",
      "Choose <strong>Arrive</strong>.",
      "Tap <strong>Choose</strong> under Location and paste <code>" + coords + "</code> into the search field (Copy button above). <span class=\"sub\">" + locateAlt + "</span>",
      "Drag the blue circle until it roughly matches the " + r + " m zone shown above.",
      timeStep,
      "Add two actions: <strong>Speak Text</strong> — <code>" + esc(speakable(item)) + "</code> <span class=\"sub\">Tap Show More: pick a specific named voice (the default “Siri voice” can stay silent in automations) and turn Wait Until Finished ON.</span> Then <strong>Show Notification</strong> — <code>StationReminder: " + esc(displayName) + "</code>.",
      isTest
        ? "Tap <strong>Done</strong>. Now lock your phone, walk out of the circle, wait a couple of minutes, and walk back in — you should get the notification and the spoken line within about a minute of crossing. <span class=\"sub\">Delete the practice automation afterwards.</span>"
        : "Tap <strong>Done</strong>, then check “I’ve set this reminder up” below.",
    ];

    els.steps.innerHTML = steps.map((s) => "<li>" + s + "</li>").join("");
    els.altSteps.innerHTML =
      "In step 6, instead of Speak Text + Show Notification: add a <strong>Text</strong> action containing <code>" +
      esc(displayName) +
      "</code>, then <strong>Run Shortcut</strong> → <strong>StationReminder Ding</strong>, and set its input to the Text variable. The Ding shortcut plays a chime, speaks the name, and shows the notification.";
  }

  function persistCurrent() {
    const item = wizardItems[wizardIdx];
    const key = keyFor(item);
    if (!key || !store.configured[key]) return;
    store.configured[key].radius = currentRadius();
    store.configured[key].win = currentWin;
    saveStore();
    renderConfiguredCard();
  }

  // ---------------- events ----------------
  els.tabRail.addEventListener("click", () => setTab("rail"));
  els.tabBus.addEventListener("click", () => setTab("bus"));

  els.railSearch.addEventListener("input", () => {
    railQuery = els.railSearch.value.trim().toLowerCase();
    renderSideList();
  });

  function setTab(t) {
    tab = t;
    els.tabRail.setAttribute("aria-selected", String(t === "rail"));
    els.tabBus.setAttribute("aria-selected", String(t === "bus"));
    els.railControls.hidden = t !== "rail";
    els.busControls.hidden = t !== "bus";
    ensurePickerMap();
    if (t === "rail") {
      Object.values(railLineLayers).forEach((l) => l.addTo(pMap));
      Object.values(stationMarkers).forEach((m) => m.addTo(pMap));
      pMap.removeLayer(busRouteLayer);
      pMap.removeLayer(busStopLayer);
    } else {
      Object.values(railLineLayers).forEach((l) => pMap.removeLayer(l));
      Object.values(stationMarkers).forEach((m) => pMap.removeLayer(m));
      busRouteLayer.addTo(pMap);
      busStopLayer.addTo(pMap);
      loadBusData();
      renderBusStops();
    }
    renderSideList();
  }

  els.trayGo.addEventListener("click", () => {
    if (selection.length) startWizard(selection.slice());
  });

  els.wizardBack.addEventListener("click", exitWizard);

  els.wizPrev.addEventListener("click", () => {
    if (wizardIdx > 0) { wizardIdx--; renderWizardStep(); window.scrollTo({ top: 0 }); }
  });

  els.wizNext.addEventListener("click", () => {
    if (wizardIdx < wizardItems.length - 1) {
      wizardIdx++;
      renderWizardStep();
      window.scrollTo({ top: 0 });
    } else {
      // done — drop configured items from the live selection
      selection = selection.filter((s) => !isConfigured(s));
      exitWizard();
    }
  });

  els.openTest.addEventListener("click", () => {
    startWizard([{ kind: "test", name: "Test spot", lat: DC_CENTER[0], lon: DC_CENTER[1] }]);
  });

  els.radius.addEventListener("input", () => {
    const item = wizardItems[wizardIdx];
    if (!item) return;
    dCircle.setRadius(currentRadius());
    fitCircle(false);
    refreshDetailText();
    persistCurrent();
  });

  els.windowSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const mode = b.dataset.win;
    if (mode === "any") setWindowUI(null);
    else if (mode === "am") setWindowUI(WINDOW_PRESETS.am.slice());
    else if (mode === "pm") setWindowUI(WINDOW_PRESETS.pm.slice());
    else setWindowUI([els.winStart.value || "07:00", els.winEnd.value || "10:00"]);
    refreshDetailText();
    persistCurrent();
  });

  [els.winStart, els.winEnd].forEach((inp) =>
    inp.addEventListener("change", () => {
      if (!els.windowCustom.hidden) {
        currentWin = [els.winStart.value || "07:00", els.winEnd.value || "10:00"];
        refreshDetailText();
        persistCurrent();
      }
    })
  );

  els.configured.addEventListener("change", () => {
    const item = wizardItems[wizardIdx];
    if (!item || item.kind === "test") return;
    const key = keyFor(item);
    if (els.configured.checked) {
      store.configured[key] = {
        kind: item.kind,
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        radius: currentRadius(),
        win: currentWin,
        ts: Date.now(),
      };
    } else {
      delete store.configured[key];
    }
    saveStore();
    renderProgress();
    renderConfiguredCard();
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

  // ---------------- boot ----------------
  renderLineChips();
  ensurePickerMap();
  renderSideList();
  setupRailSearch();
  setupBusSearch();
  renderProgress();
  renderConfiguredCard();
  saveStore(); // persist any v1→v2 migration
  if (Object.keys(store.configured).length > 0) {
    els.howCard.open = false;
  }

  const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && !isLocalDev) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (isLocalDev) {
    // dev-only handle for driving the closure-scoped UI from the console/tests
    window.__sr = {
      toggleSelect: toggleSelect,
      selectRoute: selectRoute,
      setTab: setTab,
      pickerMap: () => pMap,
      busData: () => busData,
      selection: () => selection,
    };
  }
})();
