(function () {
  'use strict';

  var API_BASE = '/gander/api/rooms';

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

  function renderOffers(listEl, emptyEl, offers) {
    listEl.innerHTML = '';
    if (!offers || !offers.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    offers.forEach(function (o) {
      var li = document.createElement('li');
      li.className = 'offer';
      var head = document.createElement('div');
      head.className = 'offer-head';
      var agent = document.createElement('span');
      agent.className = 'offer-agent';
      agent.textContent = o.agent || '—';
      var price = document.createElement('span');
      price.className = 'offer-price';
      var p = o.price || {};
      price.textContent = String(p.amount) + ' ' + String(p.currency || '');
      head.appendChild(agent);
      head.appendChild(price);
      var time = document.createElement('div');
      time.className = 'offer-time';
      time.textContent = formatOfferTime(o.timestamp || '');
      var msg = document.createElement('p');
      msg.className = 'offer-msg';
      msg.textContent = o.message != null && o.message !== '' ? o.message : '(no message)';
      li.appendChild(head);
      li.appendChild(time);
      li.appendChild(msg);
      listEl.appendChild(li);
    });
  }

  function showRoomUI(room) {
    document.getElementById('load-section').hidden = true;
    document.getElementById('room-content').hidden = false;
    document.getElementById('offers-section').hidden = false;
    document.getElementById('offer-form-section').hidden = room.status === 'closed';

    document.getElementById('room-title').textContent = productTitle(room.product);
    document.getElementById('room-meta').textContent =
      'Created ' + (room.created_at ? formatOfferTime(room.created_at) : '—');
    document.getElementById('room-id').textContent = room.room_id || '—';
    document.getElementById('room-status').textContent = room.status || 'open';
    document.getElementById('product-title').textContent = productTitle(room.product);
    document.getElementById('product-json').textContent = JSON.stringify(room.product, null, 2);

    var listEl = document.getElementById('offers-list');
    var emptyEl = document.getElementById('offers-empty');
    renderOffers(listEl, emptyEl, room.offers);
  }

  function initRoom() {
    var roomId = parsePathRoomId();
    var loadStatus = document.getElementById('load-status');
    var loadErr = document.getElementById('load-error');

    if (!roomId) {
      if (loadStatus) loadStatus.hidden = true;
      showError(loadErr, 'Missing room id in URL.');
      return;
    }

    function loadRoom() {
      showError(loadErr, '');
      if (loadStatus) {
        loadStatus.hidden = false;
        loadStatus.textContent = 'Loading room…';
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
          showRoomUI(room);
        })
        .catch(function (e) {
          if (loadStatus) loadStatus.hidden = true;
          showError(loadErr, e.message || 'Failed to load room.');
        });
    }

    loadRoom();

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
          loadRoom();
          document.getElementById('message').value = '';
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
