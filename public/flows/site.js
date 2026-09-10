/* Shared plumbing for the TexFlow pages: the header, the catalogue, the sheet,
 * and the small amount of account state the site needs to know about.
 *
 * The site knows two things about a person: their name and which copies of
 * which tools are theirs. It never sees what is inside one. */
(function () {
  'use strict';

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
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }

  var ICON = {
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M13 6.5L18.5 12 13 17.5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/></svg>'
  };

  // ------------------------------------------------------------------ toast --

  var toastHost;
  function toast(msg, ms) {
    if (!toastHost) {
      toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    var t = h('div', { class: 'toast', text: msg });
    toastHost.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2400);
  }

  // ------------------------------------------------------------------ sheet --

  var openSheets = 0;
  function sheet(opts) {
    var o = opts || {};
    var scrim = h('div', { class: 'scrim' });
    var panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    if (o.title) panel.appendChild(h('h2', { text: o.title }));
    if (o.lede) panel.appendChild(h('p', { text: o.lede }));
    if (o.body) panel.appendChild(o.body);

    var handle = {
      el: panel,
      close: function () {
        scrim.className = 'scrim';
        panel.className = 'sheet';
        document.removeEventListener('keydown', onKey);
        // Only the last sheet standing gives the page its scrolling back — an
        // action that opens another sheet must not unlock the one behind it.
        if (--openSheets <= 0) { openSheets = 0; document.body.style.overflow = ''; }
        setTimeout(function () { scrim.remove(); panel.remove(); }, 340);
        if (o.onClose) o.onClose();
      }
    };
    function onKey(e) { if (e.key === 'Escape') handle.close(); }

    if (o.actions) {
      var stack = h('div', { class: 'stack' });
      o.actions.forEach(function (a) {
        stack.appendChild(h('button', {
          class: 'btn ' + (a.kind || '') + ' wide', type: 'button',
          // Action first, close second — `confirm` resolves from onClose, so
          // the other order answers "no" before the button is heard.
          onclick: function () { if (a.onClick) a.onClick(); if (!a.keepOpen) handle.close(); }
        }, a.label));
      });
      panel.appendChild(stack);
    }

    scrim.addEventListener('click', handle.close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    document.body.style.overflow = 'hidden';
    openSheets++;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrim.className = 'scrim open';
        panel.className = 'sheet open';
      });
    });
    return handle;
  }

  function confirm(o) {
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (v) { if (!settled) { settled = true; resolve(v); } };
      sheet({
        title: o.title, lede: o.lede,
        onClose: function () { done(false); },
        actions: [
          { label: o.confirmLabel || 'Yes', kind: o.danger ? 'danger' : '', onClick: function () { done(true); } },
          { label: 'Cancel', kind: 'ghost', onClick: function () { done(false); } }
        ]
      });
    });
  }

  // ------------------------------------------------------------------- data --

  var catalogPromise = null;
  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/f/index.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : { areas: [], flows: [] }; })
        .catch(function () { return { areas: [], flows: [] }; });
    }
    return catalogPromise;
  }

  function api(path, options) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw Object.assign(new Error(body.error || 'Something went wrong'), { status: r.status, body: body });
          return body;
        });
      });
  }

  var mePromise = null;
  function me(force) {
    if (force || !mePromise) mePromise = api('/api/flows/me').catch(function () { return { user: null, copies: [] }; });
    return mePromise;
  }

  // ------------------------------------------------------------------ header --

  function header(active) {
    var top = $('.top');
    if (!top) return;
    var sentinel = h('div', { style: { position: 'absolute', top: '0', height: '1px', width: '100%' } });
    document.body.prepend(sentinel);
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        top.classList.toggle('is-stuck', !entries[0].isIntersecting);
      }).observe(sentinel);
    }

    var slot = $('#top-account');
    if (!slot) return;
    me().then(function (state) {
      slot.innerHTML = '';
      if (state.user) {
        slot.appendChild(h('a', {
          class: 'btn small', href: '/flows'
        }, active === 'shelf' ? state.user.name : 'Your Flows'));
      } else {
        slot.appendChild(h('a', { class: 'btn small ghost', href: '/flows' }, 'Sign in'));
      }
    });
  }

  // ------------------------------------------------------------ copy to hand --

  function copy(text, said) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { toast(said || 'Copied'); return true; })
        .catch(function () { showText(text); return false; });
    }
    showText(text);
    return Promise.resolve(false);
  }

  function showText(text) {
    var input = h('input', { class: 'input mono', value: text, readonly: true });
    sheet({ title: 'Here it is', lede: 'Select it and copy it by hand — the browser would not do it for us.', body: h('div', {}, input) });
    setTimeout(function () { input.focus(); input.select(); }, 380);
  }

  // A share always mints a fresh copy, so what lands in someone's messages is
  // theirs alone. The Web Share sheet is used where it exists; everywhere else
  // the link goes to the clipboard, which is the same thing one step later.
  function shareFlow(flowId, name) {
    return api('/api/flows/gift', { method: 'POST', body: JSON.stringify({ flowId: flowId }) })
      .then(function (res) {
        var payload = {
          title: name,
          text: name + ' — a small TexFlow tool. Tap it, use it, keep it if you want it.',
          url: res.url
        };
        if (navigator.share) {
          return navigator.share(payload).then(function () { return res.url; }, function () { copy(res.url, 'Link copied'); return res.url; });
        }
        copy(res.url, 'Link copied — paste it to whoever needs it');
        return res.url;
      })
      .catch(function () { toast('Could not make a link just now'); return null; });
  }

  window.Tex = {
    $: $, $$: $$, h: h, icons: ICON,
    toast: toast, sheet: sheet, confirm: confirm,
    catalog: catalog, api: api, me: me,
    header: header, copy: copy, shareFlow: shareFlow
  };
})();
