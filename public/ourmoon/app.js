/* OurMoon — client.
 *
 * One Leaflet map in lunar south polar stereographic, one bottom sheet that
 * swaps content by stage, and a claim flow that mirrors the server's siting
 * rules so the player gets an answer on every drag instead of on submit.
 *
 * Rules (server is authoritative — see routes/ourmoon/index.js):
 *   base + LTEC must clear every other claim by 10 km
 *   LTEC must sit in a peak of eternal light
 *   LTEC must be within 10 km of a PSR, and within 10 km of its own base
 */
(function () {
  "use strict";

  var MOON_R = 1737.4;          // km
  var CLEARANCE_KM = 10;
  var LTEC_PSR_MAX_KM = 10;
  var LTEC_BASE_MAX_KM = 10;

  var state = {
    user: null,
    myBase: null,
    memberOf: [],
    bases: [],
    psrs: [],
    pels: [],
    stage: "welcome",
    draft: null,              // { name, base:{lat,lon}, ltec:{lat,lon}, ltecName }
    focus: null,              // base being viewed in the sheet
    pendingJoin: null,
    lastUsername: "",
    busy: false,
    error: ""
  };

  // ------------------------------------------------------------ geometry ---

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function gcDist(lat1, lon1, lat2, lon2) {
    var p1 = toRad(lat1), p2 = toRad(lat2);
    var dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return MOON_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function destPoint(lat, lon, distKm, brgDeg) {
    var d = distKm / MOON_R, t = toRad(brgDeg);
    var p1 = toRad(lat), l1 = toRad(lon);
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [toDeg(p2), toDeg(l2)];
  }

  // Geodesic circle as a polygon, so rings stay anchored to the ground through
  // any pan or zoom rather than drifting with the projection.
  function circlePoly(lat, lon, radiusKm, steps) {
    steps = steps || 48;
    var pts = [];
    for (var i = 0; i <= steps; i++) pts.push(destPoint(lat, lon, radiusKm, (360 / steps) * i));
    return pts;
  }

  function normLon(lon) { return ((lon % 360) + 360) % 360; }
  function fmtCoord(lat, lon) { return Math.abs(lat).toFixed(3) + "°S · " + normLon(lon).toFixed(3) + "°E"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------- rule checks ---

  function nearestPsr(lat, lon) {
    var best = null;
    for (var i = 0; i < state.psrs.length; i++) {
      var p = state.psrs[i];
      var edge = gcDist(lat, lon, p.lat, p.lon) - p.radius_km;
      if (!best || edge < best.edge_km) {
        best = { id: p.id, feature: p.feature || p.id, area_km2: p.area_km2, edge_km: edge };
      }
    }
    return best;
  }

  function containingPel(lat, lon) {
    var best = null;
    for (var i = 0; i < state.pels.length; i++) {
      var pel = state.pels[i];
      var d = gcDist(lat, lon, pel.lat, pel.lon);
      if (d <= pel.radius_km && (!best || d < best.dist)) best = { pel: pel, dist: d };
    }
    return best ? best.pel : null;
  }

  /** Nearest point belonging to any *other* claim. */
  function nearestClaim(points, excludeId) {
    var best = null;
    for (var i = 0; i < state.bases.length; i++) {
      var other = state.bases[i];
      if (excludeId && other.id === excludeId) continue;
      var theirs = [{ lat: other.lat, lon: other.lon, what: "base" }];
      if (other.ltec) theirs.push({ lat: other.ltec.lat, lon: other.ltec.lon, what: "LTEC" });
      for (var t = 0; t < theirs.length; t++) {
        for (var m = 0; m < points.length; m++) {
          var d = gcDist(points[m].lat, points[m].lon, theirs[t].lat, theirs[t].lon);
          if (!best || d < best.km) {
            best = { km: d, name: other.name, owner: other.owner, what: theirs[t].what };
          }
        }
      }
    }
    return best;
  }

  /** Client-side mirror of the server rules — instant feedback while dragging. */
  function checkClaim(draft) {
    var out = { base: {}, ltec: {}, ok: false };
    var excludeId = state.myBase ? state.myBase.id : null;

    if (draft.base) {
      var near = nearestClaim([draft.base], excludeId);
      out.base.nearest = near;
      out.base.clear = !near || near.km >= CLEARANCE_KM;
      out.base.psr = nearestPsr(draft.base.lat, draft.base.lon);
    }

    if (draft.ltec) {
      out.ltec.pel = containingPel(draft.ltec.lat, draft.ltec.lon);
      var psr = nearestPsr(draft.ltec.lat, draft.ltec.lon);
      out.ltec.psr = psr;
      out.ltec.psrReachKm = psr ? Math.max(0, psr.edge_km) : Infinity;
      out.ltec.inLight = !!out.ltec.pel;
      out.ltec.hasSink = out.ltec.psrReachKm <= LTEC_PSR_MAX_KM;
      if (draft.base) {
        out.ltec.baseKm = gcDist(draft.base.lat, draft.base.lon, draft.ltec.lat, draft.ltec.lon);
        out.ltec.linked = out.ltec.baseKm <= LTEC_BASE_MAX_KM;
      }
      var nearL = nearestClaim([draft.ltec], excludeId);
      out.ltec.nearest = nearL;
      out.ltec.clear = !nearL || nearL.km >= CLEARANCE_KM;
    }

    out.ok = !!(draft.base && draft.ltec &&
      out.base.clear && out.ltec.inLight && out.ltec.hasSink && out.ltec.linked && out.ltec.clear);
    return out;
  }

  // ----------------------------------------------------------------- map ---

  proj4.defs("IAU2000:30120",
    "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=1737400 +b=1737400 +units=m +no_defs");

  var MAX = 1100000;
  var resolutions = [];
  for (var z = 0; z < 9; z++) resolutions.push(((2 * MAX) / 256) / Math.pow(2, z));

  var crs = new L.Proj.CRS("IAU2000:30120",
    "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=1737400 +b=1737400 +units=m +no_defs",
    { origin: [-MAX, MAX], resolutions: resolutions, bounds: L.bounds([-MAX, -MAX], [MAX, MAX]) });

  var map = L.map("map", {
    crs: crs, center: [-90, 0], zoom: 3, minZoom: 1, maxZoom: 8,
    attributionControl: false, zoomControl: false, maxBoundsViscosity: 0.9,
    tap: true
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  map.setMaxBounds(L.latLngBounds(crs.unproject(L.point(-MAX, -MAX)), crs.unproject(L.point(MAX, MAX))));

  var baseLayer = null;
  var currentImagery = "luna_wac_global";
  function setImagery(name) {
    currentImagery = name;
    if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
    if (name === "none") return;
    // Same-origin caching proxy: the upstream WMS reprojects on the fly and
    // times out at depth, so tiles are cached server-side after first fetch.
    baseLayer = L.tileLayer.wms("/ourmoon/wms", {
      layers: name, format: "image/png", transparent: false, version: "1.1.1",
      crs: crs, tileSize: 256, noWrap: true,
      maxNativeZoom: 3,        // deeper zoom upscales zoom-3 imagery, which is what the WMS reliably serves
      className: "moon-imagery"
    });
    baseLayer.addTo(map);
    baseLayer.bringToBack();
  }

  var psrLayer = L.layerGroup().addTo(map);
  var pelLayer = L.layerGroup().addTo(map);
  var claimLayer = L.layerGroup().addTo(map);
  var draftLayer = L.layerGroup().addTo(map);
  var showPsr = true, showPel = true;

  // ---------------------------------------------------------------- icons ---

  var GLYPH_BASE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3.5 18a8.5 8.5 0 0 1 17 0"/><path d="M2 18h20"/>' +
    '<path d="M12 9.5V18"/><path d="M8 18a4 6 0 0 1 8 0"/></svg>';

  var GLYPH_LTEC =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 5h16"/><path d="M4 19h16"/>' +
    '<path d="M13.5 7 9 12.5h5L10.5 17"/></svg>';

  function markerIcon(kind, opts) {
    opts = opts || {};
    var cls = "om-marker " + kind + (opts.mine ? " mine" : "") + (opts.draft ? " draft" : "");
    var html = (opts.ping ? '<div class="ping"></div>' : "") +
      '<div class="glyph" style="' + (opts.color ? "color:" + opts.color : "") + '">' +
      (kind === "base" ? GLYPH_BASE : GLYPH_LTEC) + "</div>";
    return L.divIcon({ className: cls, html: html, iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function labelIcon(text) {
    return L.divIcon({ className: "om-label", html: "<span>" + esc(text) + "</span>", iconSize: [0, 0] });
  }

  // -------------------------------------------------------------- drawing ---

  function drawTerrain() {
    psrLayer.clearLayers();
    pelLayer.clearLayers();

    state.psrs.forEach(function (p) {
      var poly = L.polygon(circlePoly(p.lat, p.lon, p.radius_km, p.radius_km > 8 ? 64 : 40), {
        color: "#66d0ff", weight: 1.1, opacity: 0.8,
        fillColor: "#39b6ff", fillOpacity: 0.26, interactive: false
      });
      psrLayer.addLayer(poly);
    });

    state.pels.forEach(function (pel) {
      var poly = L.polygon(circlePoly(pel.lat, pel.lon, pel.radius_km, 44), {
        color: "#ffd977", weight: 1.4, opacity: 0.95,
        fillColor: "#ffc94d", fillOpacity: pel.ltec_viable ? 0.3 : 0.12,
        dashArray: pel.ltec_viable ? null : "3 4", interactive: true
      });
      poly.bindTooltip(
        "<b>" + esc(pel.name) + "</b><br>" + pel.illum + "% average illumination<br>" +
        (pel.ltec_viable
          ? "Cold sink " + Math.max(0, pel.nearest_psr.edge_km).toFixed(1) + " km away — LTEC viable"
          : "Nearest PSR " + pel.nearest_psr.edge_km.toFixed(1) + " km — too far for an LTEC"),
        { sticky: true, direction: "top" });
      pelLayer.addLayer(poly);
      pelLayer.addLayer(L.marker([pel.lat, pel.lon], {
        interactive: false,
        icon: L.divIcon({ className: "pel-label", html: "<span>" + esc(pel.name) + "</span>", iconSize: [0, 0] })
      }));
    });
  }

  function drawClaims() {
    claimLayer.clearLayers();
    state.bases.forEach(function (base) {
      var mine = state.myBase && base.id === state.myBase.id;
      var color = mine ? "#7ee0c8" : (base.color || "#8fa3bd");

      // The claimed land itself: a 10 km exclusion ring around the base.
      claimLayer.addLayer(L.polygon(circlePoly(base.lat, base.lon, CLEARANCE_KM, 56), {
        color: color, weight: 1.3, opacity: mine ? 0.85 : 0.55,
        fillColor: color, fillOpacity: mine ? 0.13 : 0.07, interactive: false
      }));

      var marker = L.marker([base.lat, base.lon], {
        icon: markerIcon("base", { mine: mine, color: color, ping: mine }),
        zIndexOffset: 400
      });
      marker.bindTooltip("<b>" + esc(base.name) + "</b><br>" + esc(base.owner) +
        " · " + base.member_count + " crew", { direction: "top", offset: [0, -14] });
      marker.on("click", function () { openBase(base); });
      claimLayer.addLayer(marker);
      claimLayer.addLayer(L.marker([base.lat, base.lon], {
        interactive: false, icon: labelIcon(base.name), zIndexOffset: 300
      }));

      if (base.ltec) {
        claimLayer.addLayer(L.polygon(circlePoly(base.ltec.lat, base.ltec.lon, CLEARANCE_KM, 56), {
          color: "#ff9f5c", weight: 1, opacity: mine ? 0.5 : 0.3,
          fillColor: "#ff9f5c", fillOpacity: mine ? 0.07 : 0.04,
          dashArray: "3 5", interactive: false
        }));
        var ltecMarker = L.marker([base.ltec.lat, base.ltec.lon], {
          icon: markerIcon("ltec", { mine: mine }), zIndexOffset: 380
        });
        ltecMarker.bindTooltip("<b>" + esc(base.ltec.name) + "</b><br>" +
          (base.ltec.peak_of_eternal_light ? esc(base.ltec.peak_of_eternal_light.name) + " · " +
            base.ltec.peak_of_eternal_light.illum + "% lit" : "LTEC plant"),
          { direction: "top", offset: [0, -14] });
        ltecMarker.on("click", function () { openBase(base); });
        claimLayer.addLayer(ltecMarker);
        // Power tether from plant to base.
        claimLayer.addLayer(L.polyline([[base.lat, base.lon], [base.ltec.lat, base.ltec.lon]], {
          color: "#ff9f5c", weight: 1.4, opacity: 0.7, dashArray: "2 4", interactive: false
        }));
      }
    });
  }

  // Draft markers persist across redraws — recreating them mid-drag would drop
  // the drag. Only the guide geometry (rings, tethers) is cleared and rebuilt.
  var draftMarkers = { base: null, ltec: null };

  function ensureDraftMarker(kind) {
    if (draftMarkers[kind]) return draftMarkers[kind];
    var point = state.draft[kind];
    var marker = L.marker([point.lat, point.lon], {
      draggable: true, zIndexOffset: 600,
      icon: markerIcon(kind === "base" ? "base" : "ltec", { draft: true })
    });
    marker.on("drag", function (e) {
      if (!state.draft) return;
      state.draft[kind] = clampLatLng(e.target.getLatLng());
      drawDraft({ keepMarkers: true });
      scheduleRender();
    });
    marker.on("dragend", function () { renderSheet(); });
    marker.addTo(map);
    draftMarkers[kind] = marker;
    return marker;
  }

  function clearDraft() {
    draftLayer.clearLayers();
    ["base", "ltec"].forEach(function (kind) {
      if (draftMarkers[kind]) { map.removeLayer(draftMarkers[kind]); draftMarkers[kind] = null; }
    });
  }

  function drawDraft(opts) {
    opts = opts || {};
    draftLayer.clearLayers();
    if (!state.draft) { clearDraft(); return; }
    var d = state.draft;
    var check = checkClaim(d);

    // Drop any marker whose point has gone away (a cancelled or restarted claim).
    ["base", "ltec"].forEach(function (kind) {
      if (!d[kind] && draftMarkers[kind]) {
        map.removeLayer(draftMarkers[kind]);
        draftMarkers[kind] = null;
      }
    });

    if (d.base) {
      var baseOk = check.base.clear;
      draftLayer.addLayer(L.polygon(circlePoly(d.base.lat, d.base.lon, CLEARANCE_KM, 56), {
        color: baseOk ? "#7ee0c8" : "#ff7a6b", weight: 1.6, opacity: 0.9,
        fillColor: baseOk ? "#7ee0c8" : "#ff7a6b", fillOpacity: 0.12,
        dashArray: "5 5", interactive: false
      }));
      var baseMarker = ensureDraftMarker("base");
      if (!opts.keepMarkers) baseMarker.setLatLng([d.base.lat, d.base.lon]);
      baseMarker.setIcon(markerIcon("base", { draft: true, color: baseOk ? "#7ee0c8" : "#ff7a6b" }));
    }

    if (d.ltec) {
      var ltecOk = check.ltec.inLight && check.ltec.hasSink && check.ltec.linked && check.ltec.clear;
      var ltecMarker = ensureDraftMarker("ltec");
      if (!opts.keepMarkers) ltecMarker.setLatLng([d.ltec.lat, d.ltec.lon]);
      ltecMarker.setIcon(markerIcon("ltec", { draft: true, color: ltecOk ? "#ff9f5c" : "#ff7a6b" }));

      if (d.base) {
        draftLayer.addLayer(L.polyline([[d.base.lat, d.base.lon], [d.ltec.lat, d.ltec.lon]], {
          color: check.ltec.linked ? "#ff9f5c" : "#ff7a6b", weight: 1.8, opacity: 0.9,
          dashArray: "3 5", interactive: false
        }));
      }
      if (check.ltec.psr) {
        var psr = null;
        for (var i = 0; i < state.psrs.length; i++) if (state.psrs[i].id === check.ltec.psr.id) psr = state.psrs[i];
        if (psr) {
          draftLayer.addLayer(L.polyline([[d.ltec.lat, d.ltec.lon], [psr.lat, psr.lon]], {
            color: check.ltec.hasSink ? "#39b6ff" : "#ff7a6b", weight: 1.3, opacity: 0.75,
            dashArray: "4 5", interactive: false
          }));
        }
      }
    }

    // Reach ring: how far the LTEC may sit from the base. Shown from step 3 on,
    // so the player can see where to aim before placing anything.
    if (d.base && state.stage === "claimLtec") {
      draftLayer.addLayer(L.polygon(circlePoly(d.base.lat, d.base.lon, LTEC_BASE_MAX_KM, 56), {
        color: "#ff9f5c", weight: 1, opacity: 0.4, fill: false, dashArray: "2 6", interactive: false
      }));
    }
  }

  function clampLatLng(ll) {
    return { lat: Math.max(-89.999, Math.min(-55, ll.lat)), lon: ll.lng };
  }

  // --------------------------------------------------------------- sheet ---

  var sheet = document.getElementById("sheet");
  var sheetBody = document.getElementById("sheetBody");
  var grab = document.getElementById("grab");
  var hud = document.getElementById("hud");

  // The collapsed sheet shows everything down to the end of [data-peek] — the
  // stage's headline and its primary action. offsetTop is measured against
  // #sheet (the nearest positioned ancestor), so it already includes the grab.
  function setPeek() {
    var anchor = sheetBody.querySelector("[data-peek]");
    var peek = anchor ? anchor.offsetTop + anchor.offsetHeight + 18 : 168;
    peek = Math.min(peek, Math.round(window.innerHeight * 0.55));
    sheet.style.setProperty("--sheet-peek", peek + "px");
    hud.style.setProperty("--sheet-peek", peek + "px");
  }

  function expand() { sheet.classList.remove("peeking"); }
  function collapse() { sheet.classList.add("peeking"); }
  function isPeeking() { return sheet.classList.contains("peeking"); }

  grab.addEventListener("click", function () { sheet.classList.toggle("peeking"); });

  // Drag the grab handle to open/close, with a velocity-free distance threshold.
  (function () {
    var startY = null, startPeek = false;
    grab.addEventListener("touchstart", function (e) {
      startY = e.touches[0].clientY; startPeek = isPeeking();
    }, { passive: true });
    grab.addEventListener("touchmove", function (e) {
      if (startY === null) return;
      var dy = e.touches[0].clientY - startY;
      if (dy < -28 && startPeek) { expand(); startY = null; }
      if (dy > 28 && !startPeek) { collapse(); startY = null; }
    }, { passive: true });
    grab.addEventListener("touchend", function () { startY = null; });
  })();

  var toastTimer;
  function toast(message, bad) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.classList.toggle("bad", !!bad);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function go(stage) {
    state.stage = stage;
    state.error = "";
    renderSheet();
    expand();
  }

  // ------------------------------------------------------------------ api ---

  function api(path, options) {
    options = options || {};
    return fetch("/ourmoon" + path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || "Something went wrong up there.");
        return data;
      });
    });
  }

  function refreshBases() {
    return api("/bases.json").then(function (data) {
      state.bases = data.bases || [];
      if (state.user) {
        state.myBase = state.bases.filter(function (b) { return b.owner === state.user.username; })[0] || null;
      }
      drawClaims();
    });
  }

  function refreshMe() {
    return api("/api/auth/me").then(function (data) {
      state.user = data.user;
      state.myBase = data.base;
      state.memberOf = data.member_of || [];
      renderUserChip();
    });
  }

  // ------------------------------------------------------------ rendering ---

  function renderUserChip() {
    var chip = document.getElementById("userChip");
    if (!state.user) {
      chip.innerHTML = "Sign in";
      chip.onclick = function () { go("auth"); };
      return;
    }
    var initial = state.user.username.charAt(0).toUpperCase();
    chip.innerHTML = '<span class="avatar" style="background:' + esc(state.user.color) + '">' +
      esc(initial) + "</span>" + esc(state.user.username);
    chip.onclick = function () { go("account"); };
  }

  function checkRow(pass, title, detail) {
    return '<div class="check ' + (pass ? "pass" : "fail") + '">' +
      '<span class="mark">' + (pass ? "✓" : "!") + "</span>" +
      '<span class="body"><b>' + title + "</b><small>" + detail + "</small></span></div>";
  }

  function stageWelcome() {
    var count = state.bases.length;
    var crew = state.bases.reduce(function (n, b) { return n + b.member_count; }, 0);
    return '<div data-peek>' +
      '<p class="kicker">Lunar south pole</p>' +
      "<h1>Claim your place on the Moon</h1>" +
      '<p class="lede">Pick a plot on real LROC imagery, name your base, and power it with an ' +
      "<strong>LTEC</strong> plant sited between eternal light and permanent shadow.</p>" +
      '<button class="btn primary" data-act="start">Claim a base</button>' +
      "</div>" +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="explore">Explore ' + count + " base" + (count === 1 ? "" : "s") + "</button>" +
      '<button class="btn ghost" data-act="signin">Sign in</button>' +
      "</div>" +
      '<p class="lede mt" style="margin-bottom:0">' + count + " base" + (count === 1 ? "" : "s") + " · " +
      crew + " " + (crew === 1 ? "person" : "people") + " on the Moon so far.</p>";
  }

  function stageAuth(mode) {
    var signup = mode !== "login";
    return '<div data-peek>' +
      '<p class="kicker">' + (signup ? "New settler" : "Welcome back") + "</p>" +
      "<h1>" + (signup ? "Pick your name" : "Sign in") + "</h1>" +
      '<p class="lede">' + (signup
        ? "A username is all it takes. It becomes the founder name on every base you claim."
        : "Sign in to reach your base.") + "</p>" +
      "</div>" +
      '<div class="field"><label for="f-user">Username</label>' +
      '<input id="f-user" autocomplete="username" autocapitalize="none" autocorrect="off" ' +
      'spellcheck="false" placeholder="e.g. bernie" maxlength="24" value="' +
      esc(state.lastUsername || "") + '"></div>' +
      '<div class="field"><label for="f-pass">Password</label>' +
      '<input id="f-pass" type="password" autocomplete="' + (signup ? "new-password" : "current-password") +
      '" placeholder="At least 8 characters">' +
      (signup ? '<p class="hint">Used only to get you back to your base.</p>' : "") + "</div>" +
      '<div class="err">' + esc(state.error) + "</div>" +
      '<button class="btn primary mt" data-act="' + (signup ? "do-signup" : "do-login") + '"' +
      (state.busy ? " disabled" : "") + ">" + (state.busy ? "Working…" : (signup ? "Create account" : "Sign in")) + "</button>" +
      '<p class="center mt"><button class="link" data-act="' + (signup ? "signin" : "signup") + '">' +
      (signup ? "I already have an account" : "I'm new here") + "</button></p>";
  }

  function stageClaimBase() {
    var d = state.draft || {};
    if (!d.base) {
      return '<div data-peek>' +
        '<div class="rail"><i class="on"></i><i></i><i></i></div>' +
        '<p class="kicker">Step 1 of 3</p><h1>Choose your ground</h1>' +
        '<p class="lede">Tap anywhere on the map to drop your base. You can drag it afterwards.</p>' +
        "</div>" +
        '<div class="checks">' +
        checkRow(true, "Any spot 10 km clear of another claim",
          "Green and orange rings on the map are land already spoken for.") +
        "</div>" +
        '<button class="btn ghost mt" data-act="cancel">Cancel</button>';
    }
    var check = checkClaim(d);
    var near = check.base.nearest;
    return '<div data-peek>' +
      '<div class="rail"><i class="on"></i><i></i><i></i></div>' +
      '<p class="kicker">Step 1 of 3</p><h1>Choose your ground</h1>' +
      '<p class="lede coord">' + fmtCoord(d.base.lat, d.base.lon) + "</p>" +
      '<button class="btn primary" data-act="to-name"' + (check.base.clear ? "" : " disabled") + ">" +
      (check.base.clear ? "Use this spot" : "Too close to another claim") + "</button>" +
      "</div>" +
      '<div class="checks">' +
      checkRow(check.base.clear, check.base.clear ? "Clear of every other claim" : "Inside another claim",
        near ? "Nearest is " + esc(near.name) + "'s " + near.what + ", " + near.km.toFixed(1) + " km away (needs " + CLEARANCE_KM + " km)."
             : "You are the first here. The whole pole is open.") +
      checkRow(true, "Nearest permanently shadowed region",
        check.base.psr ? esc(check.base.psr.feature) + " · " +
          (check.base.psr.edge_km < 0 ? "you are inside it" : check.base.psr.edge_km.toFixed(1) + " km to the edge") : "—") +
      "</div>" +
      '<button class="btn ghost mt" data-act="cancel">Cancel</button>';
  }

  function stageClaimName() {
    return '<div data-peek>' +
      '<div class="rail"><i class="on"></i><i class="on"></i><i></i></div>' +
      '<p class="kicker">Step 2 of 3</p><h1>Name your base</h1>' +
      '<p class="lede">This is the name everyone else sees on the map, and the one you share.</p>' +
      "</div>" +
      '<div class="field"><label for="f-name">Base name</label>' +
      '<input id="f-name" maxlength="48" placeholder="' + esc((state.user ? state.user.username : "Your") + "'s Lunar Base") + '" ' +
      'value="' + esc((state.draft && state.draft.name) || "") + '"></div>' +
      '<div class="err">' + esc(state.error) + "</div>" +
      '<button class="btn primary" data-act="to-ltec">Next: power it</button>' +
      '<button class="btn ghost mt" data-act="back-base">Back</button>';
  }

  function stageClaimLtec() {
    var d = state.draft;
    var check = checkClaim(d);
    var head = '<div data-peek>' +
      '<div class="rail"><i class="on"></i><i class="on"></i><i class="on"></i></div>' +
      '<p class="kicker">Step 3 of 3</p><h1>Site the LTEC plant</h1>';

    if (!d.ltec) {
      return head +
        '<p class="lede"><strong>Lunar Thermal Energy Conversion</strong> runs a heat engine between ' +
        "sunlit ground and a permanently shadowed crater at about 40 K. Tap a <strong>gold</strong> " +
        "region within 10 km of your base to place it.</p></div>" +
        '<div class="checks">' +
        checkRow(false, "Hot side in a peak of eternal light", "Gold regions are the near-permanently lit ridges and massifs.") +
        checkRow(false, "Cold sink within " + LTEC_PSR_MAX_KM + " km", "Blue regions are permanently shadowed — the radiator's heat dump.") +
        checkRow(false, "Within " + LTEC_BASE_MAX_KM + " km of your base", "The dashed ring around your base marks the limit.") +
        "</div>" +
        '<button class="btn ghost mt" data-act="back-name">Back</button>';
    }

    var pel = check.ltec.pel;
    var psr = check.ltec.psr;
    return head +
      '<p class="lede coord">' + fmtCoord(d.ltec.lat, d.ltec.lon) + "</p>" +
      '<button class="btn primary" data-act="do-claim"' + (check.ok && !state.busy ? "" : " disabled") + ">" +
      (state.busy ? "Founding…" : (check.ok ? "Found " + esc(d.name) : "Fix the siting below")) + "</button>" +
      "</div>" +
      '<div class="checks">' +
      checkRow(check.ltec.inLight, "Hot side in a peak of eternal light",
        pel ? esc(pel.name) + " · " + pel.illum + "% average illumination"
            : "Not on lit ground — drag it onto a gold region.") +
      checkRow(check.ltec.hasSink, "Cold sink within " + LTEC_PSR_MAX_KM + " km",
        psr ? esc(psr.feature) + " · " + (psr.edge_km < 0 ? "directly above it" : psr.edge_km.toFixed(1) + " km to the shadow edge")
            : "No permanently shadowed region in range.") +
      checkRow(check.ltec.linked, "Within " + LTEC_BASE_MAX_KM + " km of your base",
        check.ltec.baseKm != null ? check.ltec.baseKm.toFixed(1) + " km of transmission line" : "—") +
      checkRow(check.ltec.clear, "Clear of every other claim",
        check.ltec.nearest
          ? "Nearest is " + esc(check.ltec.nearest.name) + "'s " + check.ltec.nearest.what + ", " + check.ltec.nearest.km.toFixed(1) + " km away."
          : "Nothing else nearby.") +
      "</div>" +
      '<div class="field mt"><label for="f-ltec">Name this plant (optional)</label>' +
      '<input id="f-ltec" maxlength="60" placeholder="' + esc(d.name + " LTEC") + '" value="' +
      esc(d.ltecName || "") + '"></div>' +
      '<div class="err">' + esc(state.error) + "</div>" +
      '<button class="btn ghost" data-act="back-name">Back</button>';
  }

  function baseFacts(base) {
    var lit = base.ltec && base.ltec.peak_of_eternal_light;
    var cold = base.ltec && base.ltec.cold_sink;
    return '<div class="facts">' +
      '<div><span class="k">Base</span><span class="v coord">' + fmtCoord(base.lat, base.lon) + "</span></div>" +
      '<div><span class="k">Founder</span><span class="v">' + esc(base.owner) + "</span></div>" +
      (base.ltec ? '<div><span class="k">LTEC plant</span><span class="v">' + esc(base.ltec.name) + "</span></div>" +
        '<div><span class="k">Hot side</span><span class="v">' + (lit ? esc(lit.name) + " · " + lit.illum + "% lit" : "—") + "</span></div>" +
        '<div><span class="k">Cold sink</span><span class="v">' + (cold ? esc(cold.feature) + " · " +
          Math.max(0, cold.edge_km).toFixed(1) + " km" : "—") + "</span></div>" +
        '<div><span class="k">Transmission</span><span class="v">' + base.ltec.base_distance_km.toFixed(1) + " km</span></div>" : "") +
      "</div>";
  }

  function crewChips(base) {
    return '<div class="crew">' + base.members.map(function (m, i) {
      return '<span class="' + (i === 0 ? "founder" : "") + '">' + esc(m.username) +
        (i === 0 ? " · founder" : "") + "</span>";
    }).join("") + "</div>";
  }

  function stageMyBase() {
    var base = state.myBase;
    return '<div data-peek>' +
      '<p class="kicker">Your claim</p><h1>' + esc(base.name) + "</h1>" +
      '<p class="lede">' + base.member_count + " " + (base.member_count === 1 ? "person" : "people") +
      " on the crew · powered by " + esc(base.ltec ? base.ltec.name : "LTEC") + "</p>" +
      '<button class="btn primary" data-act="share">Share ' + esc(base.name) + " on the moon</button>" +
      "</div>" +
      baseFacts(base) + crewChips(base) +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="fly-mine">Show on map</button>' +
      '<button class="btn ghost" data-act="explore">Other bases</button>' +
      "</div>" +
      '<button class="btn danger mt" data-act="abandon">Abandon this base</button>';
  }

  function stageBaseDetail() {
    var base = state.focus;
    var mine = state.myBase && base.id === state.myBase.id;
    var joined = state.user && base.members.some(function (m) { return m.username === state.user.username; });
    return '<div data-peek>' +
      '<p class="kicker">Lunar base</p><h1>' + esc(base.name) + "</h1>" +
      '<p class="lede">Founded by <strong>' + esc(base.owner) + "</strong> · " +
      base.member_count + " crew</p>" +
      (mine ? '<button class="btn primary" data-act="mine">Manage your base</button>'
            : joined ? '<button class="btn" data-act="leave">Leave this base</button>'
                     : '<button class="btn primary" data-act="join"' + (state.busy ? " disabled" : "") + ">Join " + esc(base.name) + "</button>") +
      "</div>" +
      baseFacts(base) + crewChips(base) +
      '<div class="err">' + esc(state.error) + "</div>" +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-act="share-focus">Share</button>' +
      '<button class="btn ghost" data-act="explore">All bases</button>' +
      "</div>";
  }

  function stageExplore() {
    var rows = state.bases.slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    }).map(function (base) {
      return '<button class="base-row" data-base="' + esc(base.slug) + '">' +
        '<span class="swatch" style="background:' + esc(base.color) + '"></span>' +
        '<span class="meta"><b>' + esc(base.name) + "</b><small>" + esc(base.owner) + " · " +
        (base.ltec && base.ltec.peak_of_eternal_light ? esc(base.ltec.peak_of_eternal_light.name) : "unpowered") +
        "</small></span>" +
        '<span class="count">' + base.member_count + " crew</span></button>";
    }).join("");

    return '<div data-peek>' +
      '<p class="kicker">' + state.bases.length + " claimed</p><h1>Bases on the Moon</h1>" +
      '<p class="lede">Tap one to see its territory and crew.</p>' +
      (state.myBase ? '<button class="btn primary" data-act="mine">Your base</button>'
                    : '<button class="btn primary" data-act="start">Claim a base</button>') +
      "</div>" +
      '<div class="base-list">' + (rows || '<p class="empty">Nobody has claimed anything yet. Be first.</p>') + "</div>";
  }

  function stageAccount() {
    var member = state.memberOf.map(function (b) {
      return '<button class="base-row" data-base="' + esc(b.slug) + '">' +
        '<span class="swatch" style="background:' + esc(b.color) + '"></span>' +
        '<span class="meta"><b>' + esc(b.name) + "</b><small>crew · founded by " + esc(b.owner) + "</small></span></button>";
    }).join("");

    return '<div data-peek>' +
      '<p class="kicker">Signed in</p><h1>' + esc(state.user.username) + "</h1>" +
      '<p class="lede">' + (state.myBase ? "You command <strong>" + esc(state.myBase.name) + "</strong>."
                                         : "You have not claimed a base yet.") + "</p>" +
      (state.myBase ? '<button class="btn primary" data-act="mine">Your base</button>'
                    : '<button class="btn primary" data-act="start">Claim a base</button>') +
      "</div>" +
      (member ? '<p class="lede mt">Crew on</p><div class="base-list">' + member + "</div>" : "") +
      '<button class="btn ghost mt" data-act="logout">Sign out</button>';
  }

  function stageLayers() {
    function opt(value, label) {
      return '<button class="base-row" data-layer="' + value + '">' +
        '<span class="swatch" style="background:' + (currentImagery === value ? "#7ee0c8" : "#2a3444") + '"></span>' +
        '<span class="meta"><b>' + label + "</b></span></button>";
    }
    return '<div data-peek>' +
      '<p class="kicker">Map</p><h1>Layers</h1>' +
      '<p class="lede">Imagery and overlays.</p></div>' +
      '<div class="base-list">' +
      opt("luna_wac_global", "LROC WAC orthomosaic") +
      opt("luna_shaded_relief", "LOLA shaded relief") +
      opt("luna_lola_albedo", "LOLA albedo") +
      opt("none", "No imagery") +
      "</div>" +
      '<div class="base-list mt">' +
      '<button class="base-row" data-toggle="psr"><span class="swatch" style="background:' +
      (showPsr ? "#39b6ff" : "#2a3444") + '"></span><span class="meta"><b>Permanently shadowed regions</b>' +
      "<small>164 PSRs from the LROC PSR Atlas</small></span></button>" +
      '<button class="base-row" data-toggle="pel"><span class="swatch" style="background:' +
      (showPel ? "#ffc94d" : "#2a3444") + '"></span><span class="meta"><b>Peaks of eternal light</b>' +
      "<small>" + state.pels.length + " high-illumination regions</small></span></button>" +
      "</div>" +
      '<button class="btn ghost mt" data-act="close-layers">Done</button>';
  }

  var STAGES = {
    welcome: stageWelcome,
    auth: function () { return stageAuth("signup"); },
    login: function () { return stageAuth("login"); },
    claimBase: stageClaimBase,
    claimName: stageClaimName,
    claimLtec: stageClaimLtec,
    myBase: stageMyBase,
    baseDetail: stageBaseDetail,
    explore: stageExplore,
    account: stageAccount,
    layers: stageLayers
  };

  // Re-rendering replaces the sheet's markup, so anything the player has typed
  // has to be lifted into state first — dragging a marker re-renders too.
  function syncInputs() {
    var name = document.getElementById("f-name");
    var ltec = document.getElementById("f-ltec");
    var user = document.getElementById("f-user");
    if (state.draft && name) state.draft.name = name.value;
    if (state.draft && ltec) state.draft.ltecName = ltec.value;
    if (user) state.lastUsername = user.value;
  }

  function renderSheet() {
    syncInputs();
    var render = STAGES[state.stage] || stageWelcome;
    sheetBody.innerHTML = render();
    setPeek();
  }

  // Drags fire far faster than the sheet needs to update.
  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(function () { renderQueued = false; renderSheet(); });
  }

  // -------------------------------------------------------------- actions ---

  function openBase(base) {
    // Mid-claim, a tap on someone else's marker is meant for the map underneath
    // it — placing a pin, not opening their base.
    if (state.stage === "claimBase" || state.stage === "claimLtec") return;
    state.focus = base;
    go("baseDetail");
    map.panTo([base.lat, base.lon], { animate: true });
  }

  function startClaim() {
    if (!state.user) { state.pendingJoin = null; return go("auth"); }
    if (state.myBase) { return go("myBase"); }
    state.draft = { name: "", base: null, ltec: null, ltecName: "" };
    drawDraft();
    go("claimBase");
    collapse();
    toast("Tap the map to place your base");
  }

  function shareBase(base) {
    var url = location.origin + "/ourmoon/b/" + base.slug;
    var title = "Share " + base.name + " on the moon";
    var text = base.owner + " claimed " + base.name + " at the Moon's south pole. Join the crew, or claim your own ground.";
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(function () { toast("Link to " + base.name + " copied"); })
        .catch(function () { window.prompt("Copy this link:", url); });
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  function submitAuth(mode) {
    var username = (document.getElementById("f-user") || {}).value || "";
    var password = (document.getElementById("f-pass") || {}).value || "";
    state.busy = true; state.error = ""; renderSheet();
    api("/api/auth/" + mode, { method: "POST", body: { username: username.trim(), password: password } })
      .then(function (data) {
        state.user = data.user;
        state.busy = false;
        renderUserChip();
        return refreshMe().then(refreshBases);
      })
      .then(function () {
        toast("Welcome, " + state.user.username);
        if (state.pendingJoin) {
          var target = state.pendingJoin; state.pendingJoin = null;
          return joinBySlug(target);
        }
        if (state.myBase) return go("myBase");
        return startClaim();
      })
      .catch(function (err) {
        state.busy = false; state.error = err.message; renderSheet();
      });
  }

  function joinBySlug(slug) {
    state.busy = true; renderSheet();
    return api("/api/bases/" + encodeURIComponent(slug) + "/join", { method: "POST" })
      .then(function (data) {
        state.busy = false;
        toast("You're crew on " + data.base.name);
        return refreshMe().then(refreshBases).then(function () {
          state.focus = state.bases.filter(function (b) { return b.slug === slug; })[0] || data.base;
          go("baseDetail");
          map.panTo([state.focus.lat, state.focus.lon], { animate: true });
        });
      })
      .catch(function (err) {
        state.busy = false; state.error = err.message; renderSheet(); toast(err.message, true);
      });
  }

  function submitClaim() {
    var d = state.draft;
    var ltecInput = document.getElementById("f-ltec");
    if (ltecInput) d.ltecName = ltecInput.value.trim();
    state.busy = true; state.error = ""; renderSheet();
    api("/api/bases", {
      method: "POST",
      body: {
        name: d.name,
        lat: d.base.lat, lon: d.base.lon,
        ltec_lat: d.ltec.lat, ltec_lon: d.ltec.lon,
        ltec_name: d.ltecName || ""
      }
    }).then(function (data) {
      state.busy = false;
      state.draft = null;
      clearDraft();
      return refreshMe().then(refreshBases).then(function () {
        toast(data.base.name + " is on the map");
        go("myBase");
        map.flyTo([data.base.lat, data.base.lon], 5, { duration: 1.1 });
      });
    }).catch(function (err) {
      state.busy = false; state.error = err.message; renderSheet(); toast(err.message, true);
    });
  }

  function abandonBase() {
    if (!window.confirm("Abandon " + state.myBase.name + "? The ground opens up for anyone else to claim.")) return;
    api("/api/bases/" + encodeURIComponent(state.myBase.slug), { method: "DELETE" })
      .then(function () {
        toast("Base abandoned");
        return refreshMe().then(refreshBases).then(function () { go("welcome"); });
      })
      .catch(function (err) { toast(err.message, true); });
  }

  // Every sheet button routes through one delegated handler.
  sheetBody.addEventListener("click", function (event) {
    var el = event.target.closest("[data-act],[data-base],[data-layer],[data-toggle]");
    if (!el) return;

    if (el.dataset.base) {
      var found = state.bases.filter(function (b) { return b.slug === el.dataset.base; })[0];
      if (found) openBase(found);
      return;
    }
    if (el.dataset.layer) { setImagery(el.dataset.layer); renderSheet(); return; }
    if (el.dataset.toggle === "psr") {
      showPsr = !showPsr;
      if (showPsr) psrLayer.addTo(map); else map.removeLayer(psrLayer);
      renderSheet(); return;
    }
    if (el.dataset.toggle === "pel") {
      showPel = !showPel;
      if (showPel) pelLayer.addTo(map); else map.removeLayer(pelLayer);
      renderSheet(); return;
    }

    switch (el.dataset.act) {
      case "start": startClaim(); break;
      case "explore": go("explore"); break;
      case "signin": go("login"); break;
      case "signup": go("auth"); break;
      case "do-signup": submitAuth("signup"); break;
      case "do-login": submitAuth("login"); break;
      case "logout":
        api("/api/auth/logout", { method: "POST" }).then(function () {
          state.user = null; state.myBase = null; state.memberOf = [];
          renderUserChip(); drawClaims(); go("welcome"); toast("Signed out");
        });
        break;
      case "cancel":
        state.draft = null; clearDraft(); go(state.myBase ? "myBase" : "welcome");
        break;
      case "to-name": go("claimName"); break;
      case "back-base": go("claimBase"); collapse(); break;
      case "back-name": go("claimName"); break;
      case "to-ltec": {
        var input = document.getElementById("f-name");
        var name = (input ? input.value : "").trim();
        if (!name) name = state.user.username + "'s Lunar Base";
        if (name.length < 2) { state.error = "Give the base a slightly longer name."; renderSheet(); break; }
        state.draft.name = name;
        go("claimLtec");
        collapse();
        toast("Tap a gold region near your base");
        break;
      }
      case "do-claim": submitClaim(); break;
      case "mine": go("myBase"); break;
      case "fly-mine": map.flyTo([state.myBase.lat, state.myBase.lon], 5, { duration: 1 }); collapse(); break;
      case "share": shareBase(state.myBase); break;
      case "share-focus": shareBase(state.focus); break;
      case "join":
        if (!state.user) { state.pendingJoin = state.focus.slug; go("auth"); break; }
        joinBySlug(state.focus.slug);
        break;
      case "leave":
        api("/api/bases/" + encodeURIComponent(state.focus.slug) + "/leave", { method: "POST" })
          .then(function () {
            toast("You left " + state.focus.name);
            return refreshMe().then(refreshBases).then(function () {
              state.focus = state.bases.filter(function (b) { return b.slug === state.focus.slug; })[0] || state.focus;
              renderSheet();
            });
          })
          .catch(function (err) { toast(err.message, true); });
        break;
      case "abandon": abandonBase(); break;
      case "close-layers": go(state.myBase ? "myBase" : "welcome"); break;
    }
  });

  document.getElementById("layersChip").addEventListener("click", function () { go("layers"); });

  // Map taps feed the claim flow; elsewhere they just tidy the sheet away.
  map.on("click", function (e) {
    var point = clampLatLng(e.latlng);
    if (state.stage === "claimBase") {
      state.draft.base = point;
      drawDraft(); renderSheet(); expand();
      return;
    }
    if (state.stage === "claimLtec") {
      state.draft.ltec = point;
      drawDraft(); renderSheet(); expand();
      return;
    }
    if (!isPeeking()) collapse();
  });

  // ----------------------------------------------------------------- boot ---

  setImagery("luna_wac_global");

  var params = new URLSearchParams(location.search);

  Promise.all([
    api("/terrain.json"),
    api("/bases.json"),
    api("/api/auth/me")
  ]).then(function (results) {
    state.psrs = results[0].psrs || [];
    state.pels = results[0].pels || [];
    state.bases = results[1].bases || [];
    state.user = results[2].user;
    state.myBase = results[2].base;
    state.memberOf = results[2].member_of || [];

    drawTerrain();
    drawClaims();
    renderUserChip();

    if (params.get("missing")) toast("That base has been abandoned", true);

    var joinSlug = params.get("join");
    if (joinSlug) {
      var target = state.bases.filter(function (b) { return b.slug === joinSlug; })[0];
      if (target) {
        state.focus = target;
        map.setView([target.lat, target.lon], 5);
        if (!state.user) state.pendingJoin = joinSlug;
        go("baseDetail");
        return;
      }
    }
    if (params.get("claim")) { startClaim(); return; }
    if (state.myBase) { go("myBase"); map.setView([state.myBase.lat, state.myBase.lon], 4); return; }
    go(state.user ? "explore" : "welcome");
  }).catch(function (err) {
    console.error("OurMoon failed to load", err);
    toast("Could not reach the Moon. Try reloading.", true);
  });

  window.addEventListener("resize", setPeek);
})();
