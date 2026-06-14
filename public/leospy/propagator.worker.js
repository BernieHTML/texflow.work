/* LEOSpy propagation worker.
 * Runs SGP4 (satellite.js) off the main thread and returns ECEF positions
 * so the Cesium main thread only has to push Cartesian3 values into the
 * point collection — keeping rendering smooth with thousands of satellites.
 */
/* global importScripts, satellite */
importScripts('https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js');

let satrecs = [];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    satrecs = msg.sats.map((s) => {
      try {
        return satellite.twoline2satrec(s.t1, s.t2);
      } catch (_) {
        return null;
      }
    });
    self.postMessage({ type: 'ready', count: satrecs.length });
    return;
  }

  if (msg.type === 'tick') {
    const time = new Date(msg.time);
    const gmst = satellite.gstime(time);
    const n = satrecs.length;
    const out = new Float64Array(n * 3);
    const valid = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const rec = satrecs[i];
      if (!rec) continue;
      let pv;
      try {
        pv = satellite.propagate(rec, time);
      } catch (_) {
        continue;
      }
      const p = pv && pv.position;
      if (!p || Number.isNaN(p.x)) continue;
      const ecf = satellite.eciToEcf(p, gmst); // km, Earth-fixed frame
      const o = i * 3;
      out[o] = ecf.x * 1000;
      out[o + 1] = ecf.y * 1000;
      out[o + 2] = ecf.z * 1000;
      valid[i] = 1;
    }

    self.postMessage({ type: 'positions', time: msg.time, positions: out, valid }, [out.buffer, valid.buffer]);
  }
};
