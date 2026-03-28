(function () {
  'use strict';

  var API_BASE = '/gander/api/rooms';
  var POLL_MS = 3500;

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function parsePathRoomId() {
    var m = window.location.pathname.match(/\/room\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function productTitle(product) {
    if (!product || typeof product !== 'object') return 'Untitled product';
    if (typeof product.title === 'string' && product.title.trim()) return product.title.trim();
    return 'Untitled product';
  }

  function productWebsite(product) {
    if (!product || typeof product !== 'object') return '';
    var c = [
      product.url,
      product.website,
      product.product_url,
      product.productUrl,
      product.provider && product.provider.website,
      product.merchant && (product.merchant.url || product.merchant.website),
      product.seller && (product.seller.url || product.seller.website),
      product.brand && product.brand.url,
    ];
    for (var i = 0; i < c.length; i++) {
      if (typeof c[i] === 'string' && c[i].trim()) return c[i].trim();
    }
    return '';
  }

  function productDescriptionPlain(product) {
    if (!product || typeof product !== 'object') return '';
    var d = product.description;
    if (typeof d === 'string' && d.trim()) return d.trim();
    if (d && typeof d === 'object' && typeof d.plain === 'string' && d.plain.trim()) return d.plain.trim();
    if (d && typeof d === 'object' && typeof d.text === 'string' && d.text.trim()) return d.text.trim();
    return '';
  }

  function fmtMoney(obj) {
    if (!obj || typeof obj !== 'object') return '';
    var a = obj.amount;
    var c = obj.currency;
    if (typeof a !== 'number' || !Number.isFinite(a)) return '';
    var cur = typeof c === 'string' && c ? c : '';
    return String(a) + (cur ? ' ' + cur : '');
  }

  function productPriceSummary(product) {
    if (!product || typeof product !== 'object') return '';
    var pr = product.price_range || product.priceRange;
    if (pr && typeof pr === 'object') {
      var mn = fmtMoney(pr.min);
      var mx = fmtMoney(pr.max);
      if (mn && mx && mn !== mx) return mn + ' — ' + mx;
      if (mn) return mn;
      if (mx) return mx;
    }
    if (product.price) return fmtMoney(product.price);
    var vars = product.variants;
    if (Array.isArray(vars) && vars.length === 1 && vars[0].price) return fmtMoney(vars[0].price);
    return '';
  }

  function shortId(id) {
    if (typeof id !== 'string' || !id) return '';
    return id.length > 48 ? id.slice(0, 24) + '…' + id.slice(-12) : id;
  }

  function buildSpecEntries(product) {
    var rows = [];
    if (!product || typeof product !== 'object') return rows;

    if (product.id != null) {
      rows.push({ label: 'Product ID', value: String(product.id) });
    }
    var desc = productDescriptionPlain(product);
    if (desc) {
      var clip = desc.length > 280 ? desc.slice(0, 277) + '…' : desc;
      rows.push({ label: 'Description', value: clip });
    }

    var pr = product.price_range || product.priceRange;
    if (pr && typeof pr === 'object') {
      var line = '';
      if (pr.min) line += 'Min: ' + fmtMoney(pr.min);
      if (pr.max) line += (line ? ' · ' : '') + 'Max: ' + fmtMoney(pr.max);
      if (line) rows.push({ label: 'Price range', value: line });
    }

    var vars = product.variants;
    if (Array.isArray(vars)) {
      rows.push({ label: 'Variants', value: String(vars.length) });
      if (vars.length && vars[0].title) {
        rows.push({ label: 'Default variant', value: String(vars[0].title) });
      }
    }

    if (product.vendor != null) rows.push({ label: 'Vendor', value: String(product.vendor) });
    if (product.product_type != null) rows.push({ label: 'Type', value: String(product.product_type) });
    if (product.productType != null) rows.push({ label: 'Type', value: String(product.productType) });

    return rows;
  }

  function renderProductPanel(product) {
    var nameEl = document.getElementById('product-name');
    var idLine = document.getElementById('product-id-line');
    var descEl = document.getElementById('product-desc');
    var wwwWrap = document.getElementById('product-website-wrap');
    var wwwA = document.getElementById('product-website');
    var priceBox = document.getElementById('product-price-box');
    var priceRange = document.getElementById('product-price-range');
    var specsEl = document.getElementById('product-specs');
    var jsonEl = document.getElementById('product-json');

    var title = productTitle(product);
    if (nameEl) nameEl.textContent = title;

    var pid = product && product.id != null ? String(product.id) : '';
    if (idLine) {
      idLine.textContent = pid ? shortId(pid) : '';
      idLine.hidden = !pid;
      idLine.title = pid.length > 48 ? pid : '';
    }

    var desc = productDescriptionPlain(product);
    if (descEl) {
      descEl.textContent = desc || '';
      descEl.hidden = !desc;
    }

    var web = productWebsite(product);
    if (wwwWrap && wwwA) {
      if (web) {
        wwwWrap.hidden = false;
        wwwA.href = web.indexOf('http') === 0 ? web : 'https://' + web.replace(/^\/\//, '');
        try {
          wwwA.textContent = new URL(wwwA.href).hostname || 'Open website';
        } catch (_) {
          wwwA.textContent = 'Open website';
        }
      } else {
        wwwWrap.hidden = true;
        wwwA.removeAttribute('href');
      }
    }

    var priceLine = productPriceSummary(product);
    if (priceBox && priceRange) {
      if (priceLine) {
        priceBox.hidden = false;
        priceRange.textContent = priceLine;
      } else {
        priceBox.hidden = true;
      }
    }

    if (specsEl) {
      specsEl.innerHTML = '';
      var entries = buildSpecEntries(product);
      entries.forEach(function (row) {
        var dt = document.createElement('dt');
        dt.textContent = row.label;
        var dd = document.createElement('dd');
        dd.textContent = row.value;
        specsEl.appendChild(dt);
        specsEl.appendChild(dd);
      });
      var specBlock = specsEl.closest('.spec-block');
      if (specBlock) specBlock.hidden = entries.length === 0;
    }

    if (jsonEl) jsonEl.textContent = JSON.stringify(product, null, 2);
  }

  /* ——— Home: create room ——— */
  function initHome() {
    var ta = document.getElementById('product-json');
    var btn = document.getElementById('create-btn');
    var errEl = document.getElementById('form-error');
    if (!ta || !btn) return;

    btn.addEventListener('click', function () {
      showError(errEl, '');
      var text = ta.value.trim();
      if (!text) {
        showError(errEl, 'Paste UCP product JSON first.');
        return;
      }
      var product;
      try {
        product = JSON.parse(text);
      } catch (e) {
        showError(errEl, 'Invalid JSON: ' + (e && e.message ? e.message : 'parse error'));
        return;
      }
      if (product === null || typeof product !== 'object' || Array.isArray(product)) {
        showError(errEl, 'Product must be a JSON object.');
        return;
      }

      btn.disabled = true;
      fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: product }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || r.statusText);
            return data;
          });
        })
        .then(function (data) {
          var url = data.url || '/gander/room/' + data.room_id;
          window.location.href = url;
        })
        .catch(function (e) {
          showError(errEl, e.message || 'Could not create room.');
          btn.disabled = false;
        });
    });
  }

  function formatOfferTime(iso) {
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch (_) {
      return iso;
    }
  }

  function offerKey(o) {
    var p = o.price || {};
    return (
      String(o.timestamp || '') +
      '|' +
      String(o.agent || '') +
      '|' +
      String(p.amount) +
      '|' +
      String(p.currency || '') +
      '|' +
      String(o.message || '')
    );
  }

  var lastOfferKeySet = null;

  function renderOffers(listEl, emptyEl, offers) {
    if (!listEl || !emptyEl) return;

    var showFlash = lastOfferKeySet !== null;
    listEl.innerHTML = '';

    if (!offers || !offers.length) {
      emptyEl.hidden = false;
      lastOfferKeySet = new Set();
      return;
    }
    emptyEl.hidden = true;

    var nextSet = new Set();
    offers.forEach(function (o, idx) {
      var k = offerKey(o);
      nextSet.add(k);

      var li = document.createElement('li');
      li.className = 'offer';
      if (showFlash && lastOfferKeySet && !lastOfferKeySet.has(k)) {
        li.classList.add('offer--new');
      }

      var badge = document.createElement('div');
      badge.className = 'offer-badge';
      badge.textContent = 'Offer #' + String(idx + 1);

      var head = document.createElement('div');
      head.className = 'offer-head';
      var agent = document.createElement('span');
      agent.className = 'offer-agent';
      agent.textContent = o.agent || '—';
      var price = document.createElement('span');
      price.className = 'offer-price';
      var p = o.price || {};
      var amt = p.amount;
      var cur = p.currency || '';
      price.textContent =
        (typeof amt === 'number' && Number.isFinite(amt) ? String(amt) : '—') + (cur ? ' ' + cur : '');

      head.appendChild(agent);
      head.appendChild(price);

      var time = document.createElement('div');
      time.className = 'offer-time';
      time.textContent = formatOfferTime(o.timestamp || '');

      var msg = document.createElement('p');
      msg.className = 'offer-msg';
      msg.textContent = o.message != null && o.message !== '' ? o.message : '(no message)';

      li.appendChild(badge);
      li.appendChild(head);
      li.appendChild(time);
      li.appendChild(msg);
      listEl.appendChild(li);
    });

    lastOfferKeySet = nextSet;
  }

  function initRoom() {
    var roomId = parsePathRoomId();
    var loadStatus = document.getElementById('load-status');
    var loadErr = document.getElementById('load-error');
    var pollTimer = null;

    if (!roomId) {
      if (loadStatus) loadStatus.hidden = true;
      showError(loadErr, 'Missing room id in URL.');
      return;
    }

    function applyRoom(room, silent) {
      document.getElementById('room-title').textContent = productTitle(room.product);
      document.getElementById('room-meta').textContent =
        'Created ' + (room.created_at ? formatOfferTime(room.created_at) : '—');

      renderProductPanel(room.product || {});

      document.getElementById('room-id').textContent = room.room_id || '—';
      document.getElementById('room-status').textContent = room.status || 'open';

      var listEl = document.getElementById('offers-list');
      var emptyEl = document.getElementById('offers-empty');
      renderOffers(listEl, emptyEl, room.offers);

      document.getElementById('offer-form-section').hidden = room.status === 'closed';

      var live = document.getElementById('live-pill');
      if (live) live.hidden = room.status === 'closed';

      var hint = document.getElementById('offers-sync-hint');
      if (hint) {
        hint.textContent =
          room.status === 'closed'
            ? 'This room is closed.'
            : 'Offers refresh every few seconds — open in another tab to negotiate live.';
      }

      if (!silent) {
        document.getElementById('load-section').hidden = true;
        document.getElementById('room-content').hidden = false;
        document.getElementById('offers-section').hidden = false;
      }
    }

    function loadRoom(silent) {
      if (!silent) {
        showError(loadErr, '');
        if (loadStatus) {
          loadStatus.hidden = false;
          loadStatus.textContent = 'Loading room…';
        }
      }

      fetch(API_BASE + '/' + encodeURIComponent(roomId))
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || r.statusText);
            return data;
          });
        })
        .then(function (room) {
          if (loadStatus) loadStatus.hidden = true;
          applyRoom(room, !!silent);
        })
        .catch(function (e) {
          if (loadStatus) loadStatus.hidden = true;
          if (!silent) {
            showError(loadErr, e.message || 'Failed to load room.');
          }
        });
    }

    loadRoom(false);

    pollTimer = window.setInterval(function () {
      loadRoom(true);
    }, POLL_MS);

    window.addEventListener(
      'beforeunload',
      function () {
        if (pollTimer) window.clearInterval(pollTimer);
      },
      false
    );

    var form = document.getElementById('offer-form');
    if (!form) return;

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errOffer = document.getElementById('offer-error');
      showError(errOffer, '');

      var agent = document.getElementById('agent').value.trim();
      var amountRaw = document.getElementById('amount').value;
      var currency = document.getElementById('currency').value.trim();
      var message = document.getElementById('message').value;

      var amount = Number(amountRaw);
      if (!agent) {
        showError(errOffer, 'Agent name is required.');
        return;
      }
      if (!Number.isFinite(amount)) {
        showError(errOffer, 'Enter a valid numeric price.');
        return;
      }
      if (!currency) {
        showError(errOffer, 'Currency is required.');
        return;
      }

      var submitBtn = document.getElementById('submit-offer');
      if (submitBtn) submitBtn.disabled = true;

      fetch(API_BASE + '/' + encodeURIComponent(roomId) + '/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: agent,
          price: { amount: amount, currency: currency },
          message: message,
        }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || r.statusText);
            return data;
          });
        })
        .then(function () {
          document.getElementById('message').value = '';
          loadRoom(true);
        })
        .catch(function (e) {
          showError(errOffer, e.message || 'Offer failed.');
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  if (parsePathRoomId()) {
    initRoom();
  } else {
    initHome();
  }
})();
