/* LEOSpy frontend — Cesium globe + satellite.js orbital intelligence.
 * Bulk satellites render in a PointPrimitiveCollection updated at 1 Hz from a
 * Web Worker; the selected satellite uses a live Entity for smooth following.
 */
(() => {
  'use strict';

  const TICK_MS = 1000;
  const API = '/leospy/api';

  const CATS = {
    iss:        { label: 'ISS', color: '#ffffff' },
    station:    { label: 'Space stations', color: '#ffd166' },
    starlink:   { label: 'Starlink', color: '#38e1ff' },
    comms:      { label: 'Communications', color: '#4f8cff' },
    weather:    { label: 'Weather', color: '#46f3a3' },
    imaging:    { label: 'Imaging / EO', color: '#c792ff' },
    scientific: { label: 'Scientific', color: '#7ad3ff' },
    military:   { label: 'Military', color: '#ff5d6c' },
    navigation: { label: 'Navigation', color: '#ffa94d' },
    other:      { label: 'Other', color: '#9fb3d1' }
  };

  const state = {
    viewer: null,
    scene: null,
    satellites: [],
    pointCollection: null,
    worker: null,
    latestValid: null,
    filtersOn: {},
    selected: null,
    selectedSatrec: null,
    selectedEntity: null,
    orbitEntity: null,
    orbitMode: 0,
    liveOn: true,
    following: false,
    userLocation: null,
    cesiumColors: {}
  };

  const $ = (id) => document.getElementById(id);
  const d2r = (d) => (d * Math.PI) / 180;

  // ---------- Boot ----------
  async function boot() {
    setStatus('Loading configuration…');
    let config = {};
    try { config = await fetch(`${API}/config`).then((r) => r.json()); } catch (_) {}

    try {
      await createViewer(config.cesiumIonToken);
    } catch (e) {
      setStatus('Failed to initialise globe: ' + e.message);
      return;
    }

    setStatus('Fetching satellite catalogue…');
    let data;
    try {
      data = await fetch(`${API}/satellites`).then((r) => r.json());
    } catch (e) {
      setStatus('Satellite feed unavailable.');
      return;
    }

    state.satellites = data.satellites || [];
    $('source-pill').textContent = `Source: ${data.source || '—'}`;
    if (data.error) setStatus(data.error);

    Object.keys(CATS).forEach((c) => { state.filtersOn[c] = true; });
    Object.keys(CATS).forEach((c) => {
      state.cesiumColors[c] = Cesium.Color.fromCssColorString(CATS[c].color);
    });

    buildPoints();
    buildFilters();
    startWorker();
    bindUI();

    // Cinematic entry
    state.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(135, -25, 26000000),
      duration: 2.4,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 }
    });
  }

  // ---------- Cesium ----------
  async function createViewer(ionToken) {
    if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

    const opts = {
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: false,
      contextOptions: { webgl: { powerPreference: 'high-performance' } }
    };

    if (!ionToken) {
      // Free, no-token satellite imagery so the globe always renders.
      opts.baseLayer = Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(
          'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer'
        ),
        {}
      );
      opts.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    const viewer = new Cesium.Viewer('cesiumContainer', opts);
    state.viewer = viewer;
    state.scene = viewer.scene;

    if (ionToken) {
      try { viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain()); } catch (_) {}
    }

    const scene = viewer.scene;
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = true;
    scene.skyAtmosphere.show = true;
    scene.fog.enabled = true;
    scene.highDynamicRange = true;
    viewer.clock.shouldAnimate = true; // drives realistic sun position
    viewer.scene.globe.depthTestAgainstTerrain = false;

    // Subtle glow for a premium look
    try {
      const bloom = scene.postProcessStages.bloom;
      bloom.enabled = true;
      bloom.uniforms.glowOnly = false;
      bloom.uniforms.contrast = 120;
      bloom.uniforms.brightness = -0.3;
      bloom.uniforms.delta = 1.0;
      bloom.uniforms.sigma = 2.0;
      bloom.uniforms.stepSize = 1.0;
    } catch (_) {}

    // Disable default double-click tracking; we manage selection ourselves.
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    state.pointCollection = scene.primitives.add(new Cesium.PointPrimitiveCollection());

    setupPicking();
  }

  function sizeFor(sat) {
    if (sat.c === 'iss') return 15;
    if (sat.c === 'station') return 12;
    if (sat.featured) return 10;
    if (sat.c === 'starlink') return 4;
    return 6;
  }

  function buildPoints() {
    const col = state.pointCollection;
    state.satellites.forEach((sat, i) => {
      const cart = new Cesium.Cartesian3();
      const pp = col.add({
        position: cart,
        color: state.cesiumColors[sat.c] || state.cesiumColors.other,
        pixelSize: sizeFor(sat),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.35),
        outlineWidth: sat.c === 'iss' || sat.featured ? 1.5 : 0,
        show: false,
        id: sat,
        scaleByDistance: new Cesium.NearFarScalar(2.0e6, 1.5, 4.2e7, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 6.0e7, 0.45)
      });
      sat._pp = pp;
      sat._cart = cart;
      sat._idx = i;
    });
  }

  // ---------- Worker propagation ----------
  function startWorker() {
    state.worker = new Worker('/leospy/propagator.worker.js');
    state.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        state.worker.postMessage({ type: 'tick', time: Date.now() });
      } else if (msg.type === 'positions') {
        applyPositions(msg.positions, msg.valid);
      }
    };
    state.worker.postMessage({
      type: 'init',
      sats: state.satellites.map((s) => ({ t1: s.t1, t2: s.t2 }))
    });
    setInterval(() => {
      if (state.liveOn && state.worker) state.worker.postMessage({ type: 'tick', time: Date.now() });
    }, TICK_MS);
    setInterval(updateSelectedMetrics, TICK_MS);
  }

  function applyPositions(pos, valid) {
    state.latestValid = valid;
    const sats = state.satellites;
    for (let i = 0; i < sats.length; i++) {
      const s = sats[i];
      if (!s._pp) continue;
      if (!valid[i]) { s._pp.show = false; continue; }
      const o = i * 3;
      Cesium.Cartesian3.fromElements(pos[o], pos[o + 1], pos[o + 2], s._cart);
      s._pp.position = s._cart;
      s._pp.show = state.filtersOn[s.c];
    }
    updateCount();
    finishLoading();
  }

  // ---------- Picking ----------
  function setupPicking() {
    const handler = new Cesium.ScreenSpaceEventHandler(state.scene.canvas);
    const tip = $('tooltip');

    handler.setInputAction((movement) => {
      const sat = pickSat(movement.endPosition);
      if (sat) {
        tip.hidden = false;
        tip.style.left = movement.endPosition.x + 'px';
        tip.style.top = movement.endPosition.y + 'px';
        tip.innerHTML = `<div class="tt-cat">${(CATS[sat.c] || {}).label || sat.c}</div>${escapeHtml(sat.name)}`;
        state.scene.canvas.style.cursor = 'pointer';
      } else {
        tip.hidden = true;
        state.scene.canvas.style.cursor = 'default';
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((click) => {
      const sat = pickSat(click.position);
      if (sat) selectSatellite(sat);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function pickSat(pos) {
    const picked = state.scene.pick(pos);
    if (!picked) return null;
    if (picked.id && picked.id.n) return picked.id;
    if (picked.primitive && picked.primitive.id && picked.primitive.id.n) return picked.primitive.id;
    if (picked.id && picked.id._leoSat) return picked.id._leoSat;
    return null;
  }

  // ---------- Selection + detail ----------
  function selectSatellite(sat) {
    state.selected = sat;
    try { state.selectedSatrec = satellite.twoline2satrec(sat.t1, sat.t2); } catch (_) { state.selectedSatrec = null; }

    if (state.selectedEntity) { state.viewer.entities.remove(state.selectedEntity); state.selectedEntity = null; }
    const satrec = state.selectedSatrec;
    state.selectedEntity = state.viewer.entities.add({
      position: new Cesium.CallbackProperty((time, result) => liveCartesian(satrec, Cesium.JulianDate.toDate(time), result), false),
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromCssColorString('#38e1ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      label: {
        text: sat.name,
        font: '600 13px Inter, sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -22),
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0a1222dd'),
        scaleByDistance: new Cesium.NearFarScalar(2e6, 1, 5e7, 0.4)
      },
      viewFrom: new Cesium.Cartesian3(0, -2.6e6, 1.8e6)
    });
    state.selectedEntity._leoSat = sat;

    buildOrbit();
    showDetail(sat);
    updateSelectedMetrics();
    flyToSelected();
  }

  function liveCartesian(satrec, date, result) {
    if (!satrec) return undefined;
    let pv;
    try { pv = satellite.propagate(satrec, date); } catch (_) { return undefined; }
    if (!pv || !pv.position) return undefined;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    return Cesium.Cartesian3.fromElements(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000, result || new Cesium.Cartesian3());
  }

  function showDetail(sat) {
    $('detail').classList.remove('hidden');
    const cat = CATS[sat.c] || { label: sat.c };
    $('detail-cat').textContent = cat.label;
    $('detail-name').textContent = sat.name;
    $('detail-norad').textContent = sat.n;
    $('detail-country').textContent = sat.co || 'Unknown';
    $('m-inc').textContent = sat.inc != null ? sat.inc.toFixed(2) + '°' : '—';
    $('m-period').textContent = sat.period != null ? sat.period.toFixed(1) + ' min' : '—';
    $('m-type').textContent = sat.ot || 'PAYLOAD';
    $('m-launch').textContent = sat.ld || '—';

    const badge = $('detail-badge');
    if (sat.c === 'iss' || sat.c === 'starlink' || sat.featured) {
      badge.hidden = false;
      badge.textContent = sat.c === 'iss' ? 'ISS' : sat.c === 'starlink' ? 'STARLINK' : 'FEATURED';
    } else {
      badge.hidden = true;
    }
    $('follow-btn').classList.toggle('active', state.following);
    $('follow-btn').textContent = state.following ? 'Following' : 'Follow satellite';
  }

  function updateSelectedMetrics() {
    const sat = state.selected;
    if (!sat || !state.selectedSatrec || $('detail').classList.contains('hidden')) return;
    const now = new Date();
    let pv;
    try { pv = satellite.propagate(state.selectedSatrec, now); } catch (_) { return; }
    if (!pv || !pv.position) return;
    const gmst = satellite.gstime(now);
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(gd.latitude);
    const lon = satellite.degreesLong(gd.longitude);
    const altKm = gd.height;
    const v = pv.velocity;
    const speed = v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : null;

    $('m-alt').textContent = altKm != null ? altKm.toFixed(0) + ' km' : '—';
    $('m-vel').textContent = speed != null ? speed.toFixed(2) + ' km/s' : '—';
    $('m-lat').textContent = lat.toFixed(2) + '°';
    $('m-lon').textContent = lon.toFixed(2) + '°';

    const oh = $('m-overhead');
    if (state.userLocation) {
      const el = elevationFor(state.selectedSatrec, now);
      if (el != null && el > 0) {
        oh.textContent = `Overhead now · ${el.toFixed(0)}° elevation`;
        oh.classList.add('visible');
      } else {
        oh.textContent = el != null ? `Below horizon (${el.toFixed(0)}°)` : 'Visibility: —';
        oh.classList.remove('visible');
      }
    } else {
      oh.textContent = 'Enable location to check visibility';
      oh.classList.remove('visible');
    }
  }

  // ---------- Orbit path ----------
  function buildOrbit() {
    if (state.orbitEntity) { state.viewer.entities.remove(state.orbitEntity); state.orbitEntity = null; }
    if (!state.orbitMode || !state.selectedSatrec || !state.selected) return;

    const satrec = state.selectedSatrec;
    const periodMin = state.selected.period || 95;
    let spanMin;
    let stepMin;
    if (state.orbitMode === 24) { spanMin = 1440; stepMin = 2; }
    else { spanMin = periodMin * state.orbitMode; stepMin = Math.max(0.4, periodMin / 140); }

    const positions = [];
    const start = Date.now();
    for (let m = 0; m <= spanMin; m += stepMin) {
      const t = new Date(start + m * 60000);
      let pv;
      try { pv = satellite.propagate(satrec, t); } catch (_) { continue; }
      if (!pv || !pv.position) continue;
      const gmst = satellite.gstime(t);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      positions.push(new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000));
    }
    if (positions.length < 2) return;

    state.orbitEntity = state.viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.fromCssColorString('#38e1ff').withAlpha(0.85)
        })
      }
    });
  }

  function flyToSelected() {
    if (!state.selectedEntity) return;
    state.viewer.flyTo(state.selectedEntity, {
      duration: 1.4,
      offset: new Cesium.HeadingPitchRange(0, -0.45, 3.2e6)
    }).catch(() => {});
  }

  // ---------- Filters ----------
  function buildFilters() {
    const counts = {};
    Object.keys(CATS).forEach((c) => { counts[c] = 0; });
    state.satellites.forEach((s) => { counts[s.c] = (counts[s.c] || 0) + 1; });

    const list = $('filter-list');
    list.innerHTML = '';
    Object.keys(CATS).forEach((c) => {
      if (!counts[c]) return;
      const row = document.createElement('label');
      row.className = 'filter-row';
      row.innerHTML = `
        <span class="filter-swatch" style="color:${CATS[c].color};background:${CATS[c].color}"></span>
        <span class="filter-name">${CATS[c].label}</span>
        <span class="filter-count">${counts[c].toLocaleString()}</span>
        <input type="checkbox" checked data-cat="${c}">`;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        state.filtersOn[c] = input.checked;
        row.classList.toggle('off', !input.checked);
        applyFilter();
      });
      list.appendChild(row);
    });
  }

  function applyFilter() {
    for (const s of state.satellites) {
      if (!s._pp) continue;
      const visible = state.filtersOn[s.c] && (!state.latestValid || state.latestValid[s._idx]);
      s._pp.show = visible;
    }
    updateCount();
  }

  function updateCount() {
    let n = 0;
    for (const s of state.satellites) if (s._pp && s._pp.show) n++;
    $('count-visible').textContent = n.toLocaleString();
  }

  // ---------- Search ----------
  function bindSearch() {
    const input = $('search');
    const box = $('search-results');
    let activeIdx = -1;
    let matches = [];

    const render = () => {
      if (!matches.length) { box.classList.remove('open'); box.innerHTML = ''; return; }
      box.innerHTML = matches.map((s, i) => `
        <div class="search-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
          <span class="si-name">${escapeHtml(s.name)}</span>
          <span class="si-meta">${(CATS[s.c] || {}).label || s.c} · ${s.n}</span>
        </div>`).join('');
      box.classList.add('open');
      box.querySelectorAll('.search-item').forEach((el) => {
        el.addEventListener('click', () => choose(matches[Number(el.dataset.idx)]));
      });
    };

    const choose = (sat) => {
      input.value = sat.name;
      box.classList.remove('open');
      selectSatellite(sat);
    };

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      activeIdx = -1;
      if (q.length < 2) { matches = []; render(); return; }
      matches = state.satellites
        .filter((s) =>
          s.name.toLowerCase().includes(q) ||
          String(s.n).includes(q) ||
          (s.co && s.co.toLowerCase().includes(q)) ||
          ((CATS[s.c] || {}).label || '').toLowerCase().includes(q))
        .slice(0, 12);
      render();
    });

    input.addEventListener('keydown', (e) => {
      if (!matches.length) return;
      if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, matches.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(matches[activeIdx >= 0 ? activeIdx : 0]); }
      else if (e.key === 'Escape') { box.classList.remove('open'); }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) box.classList.remove('open');
    });
  }

  // ---------- Location / overhead ----------
  function elevationFor(satrec, when) {
    if (!state.userLocation || !satrec) return null;
    let pv;
    try { pv = satellite.propagate(satrec, when); } catch (_) { return null; }
    if (!pv || !pv.position) return null;
    const gmst = satellite.gstime(when);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const observer = {
      longitude: d2r(state.userLocation.lon),
      latitude: d2r(state.userLocation.lat),
      height: (state.userLocation.alt || 0) / 1000
    };
    const look = satellite.ecfToLookAngles(observer, ecf);
    return (look.elevation * 180) / Math.PI;
  }

  function locate() {
    if (!navigator.geolocation) { setStatus('Geolocation not supported.'); return; }
    $('overhead').classList.remove('hidden');
    $('overhead-sub').textContent = 'Pinpointing your location…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.userLocation = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude || 0 };
        computeOverhead();
        if (state._overheadTimer) clearInterval(state._overheadTimer);
        state._overheadTimer = setInterval(computeOverhead, 5000);
      },
      (err) => { $('overhead-sub').textContent = 'Location permission denied.'; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  function computeOverhead() {
    if (!state.userLocation) return;
    const now = new Date();
    const visible = [];
    for (const s of state.satellites) {
      if (!state.filtersOn[s.c]) continue;
      let rec = s._searchRec;
      if (!rec) { try { rec = satellite.twoline2satrec(s.t1, s.t2); s._searchRec = rec; } catch (_) { continue; } }
      const el = elevationFor(rec, now);
      if (el != null && el > 10) visible.push({ s, el });
    }
    visible.sort((a, b) => b.el - a.el);
    const top = visible.slice(0, 14);
    $('overhead-sub').textContent = `${visible.length} satellites above 10° at your location`;
    $('overhead-list').innerHTML = top.map((v) => `
      <div class="overhead-item" data-n="${v.s.n}">
        <span class="filter-swatch" style="color:${(CATS[v.s.c]||{}).color || '#fff'};background:${(CATS[v.s.c]||{}).color || '#fff'}"></span>
        <span class="oi-name">${escapeHtml(v.s.name)}</span>
        <span class="oi-el">${v.el.toFixed(0)}°</span>
      </div>`).join('') || '<p class="overhead-sub">Nothing high in the sky right now — check back soon.</p>';
    $('overhead-list').querySelectorAll('.overhead-item').forEach((el) => {
      el.addEventListener('click', () => {
        const sat = state.satellites.find((x) => x.n === Number(el.dataset.n));
        if (sat) selectSatellite(sat);
      });
    });
  }

  // ---------- UI bindings ----------
  function bindUI() {
    bindSearch();

    $('detail-close').addEventListener('click', () => {
      $('detail').classList.add('hidden');
      setFollow(false);
      if (state.selectedEntity) { state.viewer.entities.remove(state.selectedEntity); state.selectedEntity = null; }
      if (state.orbitEntity) { state.viewer.entities.remove(state.orbitEntity); state.orbitEntity = null; }
      state.selected = null;
    });

    $('overhead-close').addEventListener('click', () => {
      $('overhead').classList.add('hidden');
      if (state._overheadTimer) clearInterval(state._overheadTimer);
    });

    $('toggle-filters').addEventListener('click', () => {
      const p = document.querySelector('.filters');
      p.classList.toggle('collapsed');
      $('toggle-filters').textContent = p.classList.contains('collapsed') ? '+' : '–';
    });

    $('orbit-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      $('orbit-seg').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.orbitMode = Number(btn.dataset.orbit);
      buildOrbit();
    });

    $('live-toggle').addEventListener('change', (e) => {
      state.liveOn = e.target.checked;
      $('live-dot').classList.toggle('paused', !state.liveOn);
      $('live-label').textContent = state.liveOn ? 'Live' : 'Paused';
    });

    $('lighting-toggle').addEventListener('change', (e) => {
      state.scene.globe.enableLighting = e.target.checked;
    });

    $('follow-btn').addEventListener('click', () => setFollow(!state.following));
    $('flyto-btn').addEventListener('click', flyToSelected);
    $('locate-btn').addEventListener('click', locate);
  }

  function setFollow(on) {
    state.following = on && !!state.selectedEntity;
    state.viewer.trackedEntity = state.following ? state.selectedEntity : undefined;
    const btn = $('follow-btn');
    btn.classList.toggle('active', state.following);
    btn.textContent = state.following ? 'Following' : 'Follow satellite';
  }

  // ---------- Helpers ----------
  function setStatus(text) {
    $('status-text').textContent = text;
    $('loading-status').textContent = text;
  }
  function finishLoading() {
    const el = $('loading');
    if (!el.classList.contains('done')) {
      el.classList.add('done');
      setTimeout(() => { el.style.display = 'none'; }, 650);
      setStatus('LEOSpy · Space-Track orbital data');
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (typeof Cesium === 'undefined') {
    setStatus('Cesium failed to load (check your connection).');
  } else {
    boot();
  }
})();
