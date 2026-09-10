/* The Flow runtime: everything a Flow gets for free.
 *
 * A Flow is one HTML file. That file is served from texflow.work, and it is
 * also the thing you download and keep. Both copies run this same code, so the
 * runtime's first job is to work out which of the two it is:
 *
 *   /f/<id>/     the catalogue copy — try it, no account needed
 *   /s/<code>/   your copy — the one a share link mints, the one Delete kills
 *   file:// etc  the downloaded file, offline, yours forever
 *
 * Its second job is the four things every Flow needs and no Flow should have
 * to write: keep its data, put itself on a home screen, hand itself to someone
 * else, and delete itself completely when asked.
 *
 * Nothing here fetches anything at load. A Flow opened from a plane still
 * works; the parts that need the network fail into a copyable link.
 */
(function () {
  'use strict';

  // The file exactly as it was served, captured at boot — after the parser has
  // seen the last script but before anything has touched the DOM. `Save the
  // file` hands this back, which is why a download works offline and works
  // from a file:// copy, where re-fetching yourself is blocked by CORS.
  // Everything a Flow needs is inline, so this one string *is* the app.
  var PRISTINE = '';

  var META = window.FLOW_META || {};
  var ORIGIN = 'https://texflow.work';

  // ------------------------------------------------------------ environment ---

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  var pathMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)\//);
  var env = {
    mode: location.protocol === 'file:' || location.protocol === 'blob:' ? 'file'
      : pathMatch ? 'instance'
      : /^\/f\//.test(location.pathname) ? 'catalog'
      : 'file',
    code: pathMatch ? pathMatch[1] : null,
    installed: standalone,
    ios: isIOS,
    android: isAndroid,
    // A Flow held as a file, or installed to a home screen, is a thing you own.
    // The catalogue copy in a browser tab is a thing you are trying.
    kept: false
  };
  env.kept = env.mode === 'file' || env.installed || env.mode === 'instance';
  env.canReachServer = location.protocol === 'http:' || location.protocol === 'https:';

  // ---------------------------------------------------------------- storage ---

  // localStorage is not a given: Safari refuses it on file:// in some versions,
  // and private windows can throw on write rather than on read. So it is probed
  // once, and a Flow that cannot persist says so instead of silently forgetting.
  var memory = {};
  var backing = (function () {
    try {
      var k = '__tf_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  })();

  var NS = 'tf:' + (META.id || 'flow') + ':';

  var store = {
    persistent: !!backing,
    get: function (key, fallback) {
      var raw;
      try {
        raw = backing ? backing.getItem(NS + key) : memory[key];
      } catch (e) { raw = memory[key]; }
      if (raw === null || raw === undefined) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      memory[key] = raw;
      if (backing) {
        try { backing.setItem(NS + key, raw); }
        catch (e) { store.persistent = false; toast('Out of space — this change is only in memory'); }
      }
      return value;
    },
    del: function (key) {
      delete memory[key];
      if (backing) { try { backing.removeItem(NS + key); } catch (e) {} }
    },
    all: function () {
      var out = {};
      if (backing) {
        try {
          for (var i = 0; i < backing.length; i++) {
            var k = backing.key(i);
            if (k && k.indexOf(NS) === 0) out[k.slice(NS.length)] = JSON.parse(backing.getItem(k));
          }
          return out;
        } catch (e) { /* fall through to memory */ }
      }
      Object.keys(memory).forEach(function (k) { try { out[k] = JSON.parse(memory[k]); } catch (e) {} });
      return out;
    },
    replace: function (data) {
      store.clear();
      Object.keys(data || {}).forEach(function (k) { store.set(k, data[k]); });
    },
    clear: function () {
      memory = {};
      if (!backing) return;
      try {
        var doomed = [];
        for (var i = 0; i < backing.length; i++) {
          var k = backing.key(i);
          if (k && k.indexOf(NS) === 0) doomed.push(k);
        }
        doomed.forEach(function (k) { backing.removeItem(k); });
      } catch (e) {}
    }
  };

  // A persisted object. Mutate it however you like and call `save()`; the Flow
  // code never touches keys or JSON.
  function state(key, defaults) {
    var obj = store.get(key, null);
    var out = {};
    Object.keys(defaults).forEach(function (k) { out[k] = defaults[k]; });
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    }
    Object.defineProperty(out, 'save', {
      value: function () { store.set(key, JSON.parse(JSON.stringify(this, replacer))); return this; },
      enumerable: false
    });
    return out;
  }
  function replacer(k, v) { return k === 'save' ? undefined : v; }

  // ------------------------------------------------------------------- dom ---

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') {
        // setProperty, not assignment, so custom properties work — several
        // Flows drive a progress fill through one.
        Object.keys(v).forEach(function (prop) {
          if (prop.indexOf('--') === 0) el.style.setProperty(prop, v[prop]);
          else el.style[prop] = v[prop];
        });
      }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ----------------------------------------------------------------- icons ---

  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var ICON = {
    more: S + '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>',
    share: S + '<path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    ios: S + '<path d="M12 3v12"/><path d="M8.5 6.5L12 3l3.5 3.5"/><rect x="4" y="10" width="16" height="11" rx="2.5"/></svg>',
    plusSquare: S + '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
    download: S + '<path d="M12 3v12"/><path d="M7.5 11.5L12 16l4.5-4.5"/><path d="M4 20h16"/></svg>',
    trash: S + '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>',
    upload: S + '<path d="M12 20V8"/><path d="M7.5 12.5L12 8l4.5 4.5"/><path d="M4 4h16"/></svg>',
    info: S + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/></svg>',
    check: S + '<path d="M4.5 12.5l5 5 10-11"/></svg>',
    x: S + '<path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: S + '<path d="M12 5v14M5 12h14"/></svg>',
    minus: S + '<path d="M5 12h14"/></svg>',
    home: S + '<path d="M4 11l8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/></svg>',
    link: S + '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.4 1.4"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.4-1.4"/></svg>'
  };

  // ----------------------------------------------------------------- toast ---

  var toastHost;
  function toast(msg, ms) {
    if (!toastHost) {
      toastHost = h('div', { class: 'flow-toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    var t = h('div', { class: 'flow-toast', text: msg });
    toastHost.appendChild(t);
    setTimeout(function () {
      t.className = 'flow-toast is-out';
      setTimeout(function () { t.remove(); }, 300);
    }, ms || 2200);
  }

  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {}
  }

  // ----------------------------------------------------------------- sheet ---

  var openSheets = 0;
  function sheet(opts) {
    var o = opts || {};
    var scrim = h('div', { class: 'flow-scrim' });
    var panel = h('div', { class: 'flow-sheet', role: 'dialog', 'aria-modal': 'true' });
    panel.appendChild(h('div', { class: 'flow-grip' }));
    if (o.title) panel.appendChild(h('h2', { text: o.title }));
    if (o.lede) panel.appendChild(h('p', { class: 'sheet-lede', text: o.lede }));
    if (o.body) panel.appendChild(o.body);

    var handle = {
      el: panel,
      close: function () {
        scrim.className = 'flow-scrim';
        panel.className = 'flow-sheet';
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { scrim.remove(); panel.remove(); }, 380);
        if (--openSheets <= 0) { openSheets = 0; document.body.style.overflow = ''; }
        if (o.onClose) o.onClose();
      }
    };
    function onKey(e) { if (e.key === 'Escape') handle.close(); }

    if (o.actions) {
      var row = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' } });
      o.actions.forEach(function (a) {
        row.appendChild(h('button', {
          class: 'flow-btn' + (a.kind ? ' is-' + a.kind : ''),
          type: 'button',
          // The action runs first and the sheet closes after it: `confirm`
          // resolves from onClose, so closing first would answer "no" before
          // the button that was pressed ever got a say.
          onclick: function () { if (a.onClick) a.onClick(); if (!a.keepOpen) handle.close(); }
        }, a.icon ? h('span', { html: ICON[a.icon] || '' }) : null, a.label));
      });
      panel.appendChild(row);
    }

    scrim.addEventListener('click', handle.close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    document.body.style.overflow = 'hidden';
    openSheets++;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrim.className = 'flow-scrim is-open';
        panel.className = 'flow-sheet is-open';
      });
    });
    return handle;
  }

  function confirm(o) {
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (v) { if (!settled) { settled = true; resolve(v); } };
      sheet({
        title: o.title,
        lede: o.lede,
        onClose: function () { done(false); },
        actions: [
          { label: o.confirmLabel || 'Yes', kind: o.danger ? 'danger' : null, onClick: function () { done(true); } },
          { label: o.cancelLabel || 'Cancel', kind: 'ghost', onClick: function () { done(false); } }
        ]
      });
    });
  }

  // ------------------------------------------------------------ formatting ---

  function num(n, dp) {
    if (!isFinite(n)) return '—';
    var d = dp === undefined ? 2 : dp;
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money(n, cur) {
    if (!isFinite(n)) return '—';
    try {
      return Number(n).toLocaleString(undefined, { style: 'currency', currency: cur || store.get('__cur', 'AUD') });
    } catch (e) { return num(n, 2); }
  }
  function dur(seconds) {
    var s = Math.max(0, Math.round(seconds));
    var m = Math.floor(s / 60);
    var hrs = Math.floor(m / 60);
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    return hrs ? hrs + ':' + pad(m % 60) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ----------------------------------------------------------------- sound ---

  // WebAudio rather than an audio file, because a Flow carries no assets. The
  // context is created on the first user gesture so iOS lets it make a sound.
  var actx = null;
  function audio() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { actx = new C(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(opts) {
    var o = opts || {};
    var ctx = audio();
    if (!ctx) return;
    var count = o.count || 1;
    for (var i = 0; i < count; i++) {
      (function (i) {
        var t = ctx.currentTime + i * (o.gap || 0.18);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = o.freq || 880;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(o.volume === undefined ? 0.22 : o.volume, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + (o.length || 0.14));
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + (o.length || 0.14) + 0.02);
      })(i);
    }
  }

  // ------------------------------------------------------------ screen lock ---

  // Timers are the one thing a Flow does that the phone actively works against.
  // Where the API exists it is used; where it does not, the Flow still counts
  // down correctly against the clock, it just does it behind a dark screen.
  var wakeLock = null;
  function keepAwake(on) {
    if (!navigator.wakeLock) return;
    if (!on) {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
      return;
    }
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  // iOS drops the lock whenever the app goes to the background; take it back.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && wakeLockWanted) keepAwake(true);
  });
  var wakeLockWanted = false;

  // ----------------------------------------------------------------- files ---

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = h('input', { type: 'file', accept: accept || '.json,application/json', style: { display: 'none' } });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.remove();
        if (!f) return resolve(null);
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { resolve(null); };
        reader.readAsText(f);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  var slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

  // Hand back the file, optionally with the current data baked into it — so a
  // downloaded copy opens on the same shopping list you were just looking at.
  function saveFile(withData) {
    var html = PRISTINE;
    if (withData) {
      var seed = '<script id="flow-seed" type="application/json">'
        + JSON.stringify(store.all()).replace(/<\//g, '<\\/')
        + '<\/script>';
      html = html.indexOf('</head>') > -1 ? html.replace('</head>', seed + '\n</head>') : seed + html;
    }
    saveBlob(new Blob([html], { type: 'text/html' }), (META.name || 'flow') + '.html');
  }

  // A file downloaded "with my data" carries a seed block. It is lifted out of
  // the document *before* PRISTINE is captured — otherwise re-saving the file
  // would bake a second, staler seed in beside the first — and applied only
  // once, so re-opening the file never overwrites work done since.
  function takeSeed() {
    var node = document.getElementById('flow-seed');
    if (!node) return null;
    var text = node.textContent || '';
    node.remove();
    return text;
  }

  function applySeed(text) {
    if (!text || store.get('__seeded', false)) return;
    try {
      var data = JSON.parse(text);
      Object.keys(data).forEach(function (k) { if (k !== '__seeded') store.set(k, data[k]); });
    } catch (e) {}
    store.set('__seeded', true);
  }

  function exportData() {
    var payload = { flow: META.id, name: META.name, exported: new Date().toISOString(), data: store.all() };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), slug(META.name || 'flow') + '-data.json');
    toast('Saved to your files');
  }

  function importData() {
    pickFile().then(function (text) {
      if (!text) return;
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { return toast('That file is not a Flow backup'); }
      var data = parsed && parsed.data ? parsed.data : parsed;
      if (parsed && parsed.flow && parsed.flow !== META.id) {
        return toast('That backup is for ' + (parsed.name || parsed.flow));
      }
      confirm({
        title: 'Replace what is here?',
        lede: 'Everything currently in ' + META.name + ' on this device will be swapped for the contents of that file.',
        confirmLabel: 'Replace it',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        store.replace(data);
        toast('Brought in');
        setTimeout(function () { location.reload(); }, 600);
      });
    });
  }

  // ----------------------------------------------------------------- share ---

  function canonicalUrl() {
    return ORIGIN + '/f/' + (META.id || '');
  }

  // A share mints a fresh copy for whoever opens it, so the recipient's Delete
  // never touches the sender's. Offline, the canonical catalogue link still
  // gets them there — it just costs them a tap to make it theirs.
  function mintGift() {
    if (!env.canReachServer || !navigator.onLine) return Promise.resolve(null);
    return fetch('/api/flows/gift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId: META.id, from: env.code || null })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.url ? j.url : null; })
      .catch(function () { return null; });
  }

  function share() {
    var pending = toast('Making a link…', 1400);
    mintGift().then(function (url) {
      var link = url || canonicalUrl();
      var payload = {
        title: META.name,
        text: META.name + ' — ' + (META.tagline || '') + '. Tap to use it, keep it if you want it.',
        url: link
      };
      if (navigator.share) {
        navigator.share(payload).catch(function () { copyLink(link); });
      } else {
        copyLink(link);
      }
    });
    return pending;
  }

  function copyLink(link) {
    var done = function () { toast('Link copied — paste it to whoever needs it'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { showLink(link); });
    } else {
      showLink(link);
    }
  }

  function showLink(link) {
    var input = h('input', { class: 'flow-input', value: link, readonly: true, style: { fontFamily: 'var(--mono)', fontSize: '13px' } });
    var body = h('div', {}, input);
    input.addEventListener('focus', function () { input.select(); });
    sheet({ title: 'Send this link', lede: 'Anyone who opens it gets their own copy.', body: body });
    setTimeout(function () { input.focus(); input.select(); }, 420);
  }

  // ------------------------------------------------- add to the home screen ---

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  function installCoach(auto) {
    if (env.installed) return toast('It is already on your home screen');

    var body = h('div', { class: 'flow-coach' });
    if (META.mark) body.appendChild(h('span', { class: 'flow-mark-lg', html: META.mark }));
    body.appendChild(h('h2', { text: 'Keep ' + META.name }));
    body.appendChild(h('p', {
      class: 'sheet-lede',
      text: env.mode === 'file'
        ? 'This copy is already yours — it lives in your files and runs with no signal at all.'
        : 'Put it on your home screen and it opens like any other app, offline included.'
    }));

    if (env.mode === 'file') {
      body.appendChild(h('p', { class: 'flow-hint', style: { textAlign: 'center' }, text: 'Nothing else to do.' }));
    } else if (deferredPrompt) {
      // Chrome and friends: there is a real prompt, so no instructions needed.
    } else if (isIOS) {
      var steps = h('ol', { class: 'flow-steps' });
      steps.appendChild(h('li', {}, h('span', { class: 'n', text: '1' }),
        h('span', { html: 'Tap ' + ICON.ios + ' <strong>Share</strong> at the bottom of Safari' })));
      steps.appendChild(h('li', {}, h('span', { class: 'n', text: '2' }),
        h('span', { html: 'Scroll down and choose ' + ICON.plusSquare + ' <strong>Add to Home Screen</strong>' })));
      steps.appendChild(h('li', {}, h('span', { class: 'n', text: '3' }),
        h('span', { html: 'Tap <strong>Add</strong>. The icon is already made.' })));
      body.appendChild(steps);
    } else {
      body.appendChild(h('p', { class: 'flow-hint', style: { textAlign: 'center' }, text: 'Open your browser menu and choose “Install” or “Add to Home screen”.' }));
    }

    var actions = [];
    if (deferredPrompt && env.mode !== 'file') {
      actions.push({
        label: 'Add to Home Screen',
        onClick: function () {
          var p = deferredPrompt;
          deferredPrompt = null;
          p.prompt();
          p.userChoice.then(function (c) { if (c.outcome === 'accepted') toast('Added'); });
        }
      });
    }
    actions.push({
      label: 'Save the file instead',
      kind: 'quiet',
      onClick: function () { saveFileSheet(); }
    });
    actions.push({ label: auto ? 'Not now' : 'Done', kind: 'ghost' });

    sheet({ body: body, actions: actions });
    store.set('__coached', true);
  }

  function saveFileSheet() {
    var hasData = Object.keys(store.all()).filter(function (k) { return k.indexOf('__') !== 0; }).length > 0;
    sheet({
      title: 'Save ' + META.name + ' to this device',
      lede: 'One file, about ' + Math.max(1, Math.round(PRISTINE.length / 1024)) + ' KB. Open it any time, with or without a signal. Nothing about it needs texflow.work again.',
      actions: hasData ? [
        { label: 'Save it with my data', onClick: function () { saveFile(true); toast('Check your downloads'); } },
        { label: 'Save an empty one', kind: 'quiet', onClick: function () { saveFile(false); toast('Check your downloads'); } },
        { label: 'Cancel', kind: 'ghost' }
      ] : [
        { label: 'Save the file', icon: 'download', onClick: function () { saveFile(false); toast('Check your downloads'); } },
        { label: 'Cancel', kind: 'ghost' }
      ]
    });
  }

  // ---------------------------------------------------------------- delete ---

  // Delete means gone: the copy stops being served, the offline cache is
  // dropped, the service worker unregisters itself and the data is wiped. What
  // it cannot touch is the icon already on a home screen or a file already
  // downloaded, so the wording says so rather than pretending otherwise.
  function purgeLocal() {
    store.clear();
    var jobs = [];
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) {
          return r.scope.indexOf(location.origin + basePath()) === 0 ? r.unregister() : null;
        }));
      }).catch(function () {}));
    }
    return Promise.all(jobs);
  }

  function basePath() {
    var m = location.pathname.match(/^(\/[sf]\/[A-Za-z0-9_-]+\/)/);
    return m ? m[1] : '/';
  }

  function remove() {
    var isCloudCopy = env.mode === 'instance';
    confirm({
      title: 'Delete ' + META.name + '?',
      lede: isCloudCopy
        ? 'This copy stops working straight away — the link goes dead, the offline cache is dropped and everything you put in it is erased. It cannot be undone.'
        : 'Everything you have put into this copy is erased and the offline cache is dropped. The file itself stays in your downloads until you delete it there.',
      confirmLabel: 'Delete it',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var server = isCloudCopy && navigator.onLine
        ? fetch('/api/flows/instance/' + env.code, { method: 'DELETE' }).catch(function () {})
        : Promise.resolve();
      Promise.all([server, purgeLocal()]).then(function () { goneScreen(isCloudCopy); });
    });
  }

  function goneScreen(wasCloud) {
    document.body.innerHTML = '';
    var wrap = h('div', { class: 'flow-gone' });
    if (META.mark) wrap.appendChild(h('span', { class: 'flow-mark-lg', html: META.mark }));
    wrap.appendChild(h('h1', { text: META.name + ' is gone' }));
    wrap.appendChild(h('p', {
      text: wasCloud
        ? 'The link no longer works and nothing of yours is left on it. If it is still on your home screen, hold the icon and remove it.'
        : 'Everything stored in this copy has been erased.'
    }));
    if (env.canReachServer) {
      wrap.appendChild(h('a', { class: 'flow-btn is-quiet', href: ORIGIN + '/flows', style: { width: 'auto', marginTop: '10px', textDecoration: 'none' } }, 'Find another Flow'));
    }
    document.body.appendChild(wrap);
  }

  // ------------------------------------------------------------------ menu ---

  function menuItem(icon, title, sub, onClick, cls) {
    return h('button', { type: 'button', class: cls || '', onclick: onClick },
      h('span', { class: 'mi', html: ICON[icon] || '' }),
      h('span', { class: 'mt' }, h('span', { text: title }), sub ? h('span', { class: 'ms', text: sub }) : null)
    );
  }

  function openMenu() {
    var list = h('div', { class: 'flow-menu' });
    var handle;

    list.appendChild(menuItem('share', 'Send it to someone',
      'They get their own copy, not yours',
      function () { handle.close(); share(); }, 'is-accent'));

    if (!env.installed && env.mode !== 'file') {
      list.appendChild(menuItem('home', 'Add to Home Screen',
        'Opens like an app, works offline',
        function () { handle.close(); installCoach(false); }));
    }

    list.appendChild(menuItem('download', 'Save the file',
      'Keep it on this device forever',
      function () { handle.close(); saveFileSheet(); }));

    list.appendChild(h('hr'));

    list.appendChild(menuItem('upload', 'Back up my data', 'One small JSON file',
      function () { handle.close(); exportData(); }));
    list.appendChild(menuItem('download', 'Bring data in', 'From a backup file',
      function () { handle.close(); importData(); }));

    list.appendChild(h('hr'));

    list.appendChild(menuItem('info', 'About this Flow', null, function () { handle.close(); about(); }));
    list.appendChild(menuItem('trash', 'Delete', env.mode === 'instance' ? 'Stops working, everywhere' : 'Erase what is stored here',
      function () { handle.close(); remove(); }, 'is-danger'));

    handle = sheet({ title: META.name, lede: META.tagline, body: list });
    return handle;
  }

  function about() {
    var where = env.mode === 'file' ? 'a file on this device'
      : env.mode === 'instance' ? 'your own copy at ' + location.origin + basePath()
      : 'the catalogue copy — send it to yourself to get one of your own';
    var body = h('div');
    var rows = [
      ['Running from', where],
      ['Storage', store.persistent ? 'Saved on this device' : 'Memory only — back up before you close it'],
      ['Offline', env.mode === 'file' ? 'Always' : (navigator.serviceWorker ? 'Yes, once it has loaded once' : 'Not on this browser')],
      ['Sends data anywhere', 'No. Everything stays on this device.']
    ];
    var ul = h('ul', { class: 'flow-list' });
    rows.forEach(function (r) {
      ul.appendChild(h('li', {}, h('span', { class: 'grow' },
        h('span', { class: 'sub', text: r[0] }), h('div', { class: 'name', style: { whiteSpace: 'normal' }, text: r[1] }))));
    });
    body.appendChild(ul);
    body.appendChild(h('p', { class: 'flow-hint', text: 'A TexFlow Flow. One file, one job.' }));
    sheet({ title: META.name, lede: META.blurb || META.tagline, body: body, actions: [{ label: 'Close', kind: 'ghost' }] });
  }

  // ----------------------------------------------------------------- chrome ---

  function buildChrome() {
    var bar = $('.flow-bar');
    if (!bar) return;
    bar.innerHTML = '';
    if (META.mark) bar.appendChild(h('span', { class: 'flow-mark-sm', html: META.mark }));
    bar.appendChild(h('span', { class: 'flow-bar-title', text: META.name || 'Flow' }));
    bar.appendChild(h('span', { class: 'flow-bar-spacer' }));
    bar.appendChild(h('button', {
      class: 'flow-icon-btn', type: 'button', 'aria-label': 'Menu', html: ICON.more, onclick: openMenu
    }));

    var sentinel = h('div', { style: { position: 'absolute', top: '0', height: '1px', width: '1px' } });
    document.body.appendChild(sentinel);
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        bar.classList.toggle('is-stuck', !entries[0].isIntersecting);
      }).observe(sentinel);
    }
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    var base = basePath();
    if (base === '/') return;
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(function () {});
  }

  // The nudge the whole share flow rests on: someone tapped a link in a
  // message, the Flow is already open and working, and *then* it offers to
  // stay. Once, never again on this device, and never over the top of a first
  // interaction — the Flow has to prove itself first.
  function maybeCoach() {
    if (env.installed || env.mode === 'file') return;
    if (store.get('__coached', false)) return;
    if (env.mode !== 'instance' && !new URLSearchParams(location.search).has('keep')) return;
    setTimeout(function () {
      if (openSheets) return;
      installCoach(true);
    }, 2600);
  }

  // ------------------------------------------------------------------- boot ---

  var readyFns = [];
  var booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    var seed = takeSeed();
    PRISTINE = '<!doctype html>\n' + document.documentElement.outerHTML;
    applySeed(seed);
    document.documentElement.style.setProperty('--a1', (META.colors && META.colors[0]) || '#0369a1');
    document.documentElement.style.setProperty('--a2', (META.colors && META.colors[1]) || '#38bdf8');
    buildChrome();
    readyFns.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    registerWorker();
    maybeCoach();
    // Any first tap is a user gesture; use it to unlock audio for the timers.
    document.addEventListener('pointerdown', function once() {
      document.removeEventListener('pointerdown', once);
      try { audio(); } catch (e) {}
    }, { once: true });
  }

  window.Flow = {
    meta: META,
    env: env,
    icons: ICON,
    ready: function (fn) { if (booted) fn(); else readyFns.push(fn); },
    $: $, $$: $$, h: h, esc: esc,
    store: store, state: state,
    toast: toast, haptic: haptic, sheet: sheet, confirm: confirm,
    num: num, money: money, dur: dur, today: today, slug: slug,
    beep: beep, audio: audio,
    keepAwake: function (on) { wakeLockWanted = !!on; keepAwake(!!on); },
    saveBlob: saveBlob, pickFile: pickFile,
    share: share, copyLink: copyLink,
    saveFile: saveFileSheet, exportData: exportData, importData: importData,
    install: function () { installCoach(false); },
    remove: remove, openMenu: openMenu
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
