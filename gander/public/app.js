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

  /* ——— Home: join room ——— */
  function initJoin() {
    var input = document.getElementById('join-code');
    var btn = document.getElementById('join-btn');
    var errEl = document.getElementById('join-error');
    if (!input || !btn) return;

    function doJoin() {
      var code = input.value.trim().replace(/^.*\/room\//, '');
      if (!code) {
        showError(errEl, 'Enter a room code.');
        return;
      }
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(code)) {
        showError(errEl, 'That doesn\'t look like a valid room code.');
        return;
      }
      showError(errEl, '');
      var base = window.location.pathname.indexOf('/gander') >= 0 ? '/gander' : '';
      window.location.href = base + '/room/' + encodeURIComponent(code);
    }

    btn.addEventListener('click', doJoin);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doJoin();
    });
  }

  /* ——— Home: create room ——— */
  function initHome() {
    var ta = document.getElementById('product-json');
    var btn = document.getElementById('create-btn');
    var errEl = document.getElementById('form-error');
    if (!ta || !btn) return;

    // Pre-fill from UCP Generator "Open in Gander" button
    try {
      var prefill = sessionStorage.getItem('gander_prefill');
      if (prefill && prefill.trim().startsWith('{')) {
        ta.value = prefill;
        sessionStorage.removeItem('gander_prefill');
      }
    } catch (_) {}

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
          var rid = data.room_id;
          if (rid && data.creator_token) {
            try { localStorage.setItem('gander_creator_' + rid, data.creator_token); } catch (_) {}
          }
          var base =
            window.location.pathname.indexOf('/gander') >= 0 ? '/gander' : '';
          window.location.href =
            base + '/negotiate-mode.html?room=' + encodeURIComponent(rid);
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

  function rememberAgent(name) {
    try {
      if (name && String(name).trim()) sessionStorage.setItem('gander_agent', String(name).trim());
    } catch (_) {}
  }

  function getAgentName() {
    var el = document.getElementById('agent');
    var v = el && el.value.trim();
    if (v) return v;
    try {
      return sessionStorage.getItem('gander_agent') || '';
    } catch (_) {
      return '';
    }
  }

  function offerHasResolution(offer) {
    var r = offer.replies || [];
    return r.some(function (x) {
      return x && (x.type === 'accept' || x.type === 'decline');
    });
  }

  function replySig(r) {
    if (!r || typeof r !== 'object') return '';
    var p = r.price || {};
    return (
      String(r.type || '') +
      '|' +
      String(r.timestamp || '') +
      '|' +
      String(r.agent || '') +
      '|' +
      String(p.amount) +
      '|' +
      String(p.currency || '') +
      '|' +
      String(r.message || '')
    );
  }

  function offerKey(o) {
    var p = o.price || {};
    var base =
      String(o.timestamp || '') +
      '|' +
      String(o.agent || '') +
      '|' +
      String(p.amount) +
      '|' +
      String(p.currency || '') +
      '|' +
      String(o.message || '');
    var reps = (o.replies || []).map(replySig).join('||');
    return base + '|' + reps;
  }

  var lastOfferKeySet = null;
  var replyFormOpen = false;

  function renderOfferReplies(offer) {
    var wrap = document.createElement('div');
    wrap.className = 'offer-replies';
    var replies = offer.replies || [];
    if (!replies.length) {
      wrap.hidden = true;
      return wrap;
    }
    replies.forEach(function (rep) {
      var line = document.createElement('div');
      line.className = 'offer-reply-line';
      var kind = rep.type || '';
      var who = rep.agent || '—';
      var when = formatOfferTime(rep.timestamp || '');
      var note = rep.message && String(rep.message).trim() ? String(rep.message).trim() : '';

      if (kind === 'counteroffer') {
        var cp = rep.price || {};
        var sk = document.createElement('span');
        sk.className = 'reply-kind';
        sk.textContent = 'Counteroffer';
        line.appendChild(sk);
        line.appendChild(document.createTextNode(' from '));
        var strong = document.createElement('strong');
        strong.textContent = who;
        line.appendChild(strong);
        line.appendChild(
          document.createTextNode(
            ' · ' + String(cp.amount) + ' ' + String(cp.currency || '') + (note ? ' — ' + note : ''),
          ),
        );
      } else if (kind === 'accept') {
        var sk2 = document.createElement('span');
        sk2.className = 'reply-kind';
        sk2.textContent = 'Accepted';
        line.appendChild(sk2);
        line.appendChild(document.createTextNode(' by '));
        var strong2 = document.createElement('strong');
        strong2.textContent = who;
        line.appendChild(strong2);
        line.appendChild(document.createTextNode(' · ' + when + (note ? ' — ' + note : '')));
      } else if (kind === 'decline') {
        var sk3 = document.createElement('span');
        sk3.className = 'reply-kind';
        sk3.textContent = 'Declined';
        line.appendChild(sk3);
        line.appendChild(document.createTextNode(' by '));
        var strong3 = document.createElement('strong');
        strong3.textContent = who;
        line.appendChild(strong3);
        line.appendChild(document.createTextNode(' · ' + when + (note ? ' — ' + note : '')));
      } else {
        line.textContent = kind + ' from ' + who;
      }
      wrap.appendChild(line);
    });
    return wrap;
  }

  function buildShareText(roomId) {
    var origin = window.location.origin || '';
    var base = origin + '/gander';
    var roomUrl = origin + '/gander/room/' + roomId;
    var lines = [
      'Welcome to Gander — negotiate a UCP product with others via the web or the terminal.',
      '',
      'Room ID: ' + roomId,
      '',
      'Room link (share in browser):',
      '  ' + roomUrl,
      '',
      '--- Terminal (API) ---',
      '',
      'STEP 1 — Read the Terms & Conditions:',
      '  curl -sS "' + base + '/api/rooms/' + roomId + '/terms" | python3 -m json.tool',
      '',
      'STEP 2 — Join the room to get your participant token (required for all actions):',
      '  curl -sS -X POST "' + base + '/api/rooms/' + roomId + '/join" \\',
      '    -H "Content-Type: application/json" \\',
      '    -d \'{"full_name":"Jane Smith","email":"jane@example.com","terms_agreed":true}\'',
      '  # Save the returned participant_token',
      '',
      'STEP 3 — Watch for offers (no token needed — anyone can observe):',
      '  curl -N "' + base + '/api/rooms/' + roomId + '/watch"',
      '',
      'STEP 4 — Submit a new offer (include your token):',
      '  curl -sS -X POST "' + base + '/api/rooms/' + roomId + '/offer" \\',
      '    -H "Content-Type: application/json" \\',
      '    -H "X-Participant-Token: YOUR_TOKEN" \\',
      '    -d \'{"agent":"my_agent","price":{"amount":900,"currency":"USD"},"message":"Here is my offer"}\'',
      '',
      'STEP 5 — Reply to offer #1 — accept/decline/counteroffer (index is 0 in the API):',
      '  curl -sS -X POST "' + base + '/api/rooms/' + roomId + '/offers/0/reply" \\',
      '    -H "Content-Type: application/json" \\',
      '    -H "X-Participant-Token: YOUR_TOKEN" \\',
      '    -d \'{"type":"accept","agent":"seller","message":"Agreed."}\'',
      '',
      'One-shot snapshot (no token needed):',
      '  curl -sS "' + base + '/api/rooms/' + roomId + '/terminal"',
      '',
    ];
    return lines.join('\n');
  }

  function renderOffers(listEl, emptyEl, offers, roomId, roomClosed, onReplyDone) {
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
      li.appendChild(renderOfferReplies(o));

      var canReply = !roomClosed && !offerHasResolution(o);
      if (canReply) {
        var actions = document.createElement('div');
        actions.className = 'offer-actions';

        var formAccept = document.createElement('div');
        formAccept.className = 'offer-reply-form';
        formAccept.hidden = true;
        formAccept.innerHTML =
          '<label for="acc-' +
          idx +
          '">Optional note (shown to the other party in the terminal)</label>' +
          '<textarea id="acc-' +
          idx +
          '" rows="2" class="offer-note"></textarea>' +
          '<p style="margin:0.5rem 0 0;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm btn-accept send-accept">Send accept</button>' +
          '<button type="button" class="btn-sm cancel-reply">Cancel</button></p>';

        var formDecline = document.createElement('div');
        formDecline.className = 'offer-reply-form';
        formDecline.hidden = true;
        formDecline.innerHTML =
          '<label for="dec-' +
          idx +
          '">Optional note (shown in the terminal)</label>' +
          '<textarea id="dec-' +
          idx +
          '" rows="2" class="offer-note"></textarea>' +
          '<p style="margin:0.5rem 0 0;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm btn-decline send-decline">Send decline</button>' +
          '<button type="button" class="btn-sm cancel-reply">Cancel</button></p>';

        var formCounter = document.createElement('div');
        formCounter.className = 'offer-reply-form';
        formCounter.hidden = true;
        formCounter.innerHTML =
          '<label>Counteroffer price</label><div class="row">' +
          '<div><input type="number" class="co-amt" step="any" placeholder="Amount" required></div>' +
          '<div><input type="text" class="co-cur" placeholder="USD" maxlength="16" required></div></div>' +
          '<label style="margin-top:0.5rem;">Message</label>' +
          '<textarea rows="2" class="co-msg" placeholder="Terms or context"></textarea>' +
          '<p style="margin:0.5rem 0 0;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
          '<button type="button" class="btn-sm btn-counter send-counter">Send counteroffer</button>' +
          '<button type="button" class="btn-sm cancel-reply">Cancel</button></p>';

        function showActions() {
          replyFormOpen = false;
          actions.hidden = false;
          formAccept.hidden = true;
          formDecline.hidden = true;
          formCounter.hidden = true;
        }

        function hideActions() {
          replyFormOpen = true;
          actions.hidden = true;
        }

        var bAccept = document.createElement('button');
        bAccept.type = 'button';
        bAccept.className = 'btn-sm btn-accept';
        bAccept.textContent = 'Accept';
        bAccept.addEventListener('click', function () {
          hideActions();
          formAccept.hidden = false;
        });

        var bDecline = document.createElement('button');
        bDecline.type = 'button';
        bDecline.className = 'btn-sm btn-decline';
        bDecline.textContent = 'Decline';
        bDecline.addEventListener('click', function () {
          hideActions();
          formDecline.hidden = false;
        });

        var bCounter = document.createElement('button');
        bCounter.type = 'button';
        bCounter.className = 'btn-sm btn-counter';
        bCounter.textContent = 'Counteroffer';
        bCounter.addEventListener('click', function () {
          hideActions();
          formCounter.hidden = false;
        });

        actions.appendChild(bAccept);
        actions.appendChild(bDecline);
        actions.appendChild(bCounter);

        formAccept.querySelector('.cancel-reply').addEventListener('click', showActions);
        formDecline.querySelector('.cancel-reply').addEventListener('click', showActions);
        formCounter.querySelector('.cancel-reply').addEventListener('click', showActions);

        formAccept.querySelector('.send-accept').addEventListener('click', function () {
          replyFormOpen = false;
          var noteEl = formAccept.querySelector('.offer-note');
          var note = noteEl ? noteEl.value : '';
          postReply(roomId, idx, { type: 'accept', message: note }, onReplyDone, showActions);
        });

        formDecline.querySelector('.send-decline').addEventListener('click', function () {
          replyFormOpen = false;
          var noteEl = formDecline.querySelector('.offer-note');
          var note = noteEl ? noteEl.value : '';
          postReply(roomId, idx, { type: 'decline', message: note }, onReplyDone, showActions);
        });

        formCounter.querySelector('.send-counter').addEventListener('click', function () {
          var amt = Number(formCounter.querySelector('.co-amt').value);
          var cur = formCounter.querySelector('.co-cur').value.trim();
          var ms = formCounter.querySelector('.co-msg').value;
          if (!Number.isFinite(amt)) {
            window.alert('Enter a valid counteroffer amount.');
            return;
          }
          if (!cur) {
            window.alert('Currency is required.');
            return;
          }
          replyFormOpen = false;
          postReply(
            roomId,
            idx,
            { type: 'counteroffer', message: ms, price: { amount: amt, currency: cur } },
            onReplyDone,
            showActions
          );
        });

        li.appendChild(actions);
        li.appendChild(formAccept);
        li.appendChild(formDecline);
        li.appendChild(formCounter);
      }

      listEl.appendChild(li);
    });

    lastOfferKeySet = nextSet;
  }

  function postReply(roomId, offerIndex, payload, onReplyDone, showActions) {
    var agent = getAgentName();
    if (!agent) {
      window.alert('Set your name in “Submit an offer” first — the other party will see it on replies.');
      if (showActions) showActions();
      return;
    }

    var body = {
      type: payload.type,
      agent: agent,
      message: payload.message == null ? '' : String(payload.message),
    };
    if (payload.type === 'counteroffer' && payload.price) {
      body.price = payload.price;
    }

    var replyHeaders = { 'Content-Type': 'application/json' };
    if (participantToken) replyHeaders['X-Participant-Token'] = participantToken;

    fetch(API_BASE + '/' + encodeURIComponent(roomId) + '/offers/' + offerIndex + '/reply', {
      method: 'POST',
      headers: replyHeaders,
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || r.statusText);
          return data;
        });
      })
      .then(function () {
        if (onReplyDone) onReplyDone();
      })
      .catch(function (e) {
        window.alert(e.message || 'Reply failed.');
        if (showActions) showActions();
      });
  }

  function initRoom() {
    var roomId = parsePathRoomId();
    var loadStatus = document.getElementById('load-status');
    var loadErr = document.getElementById('load-error');
    var pollTimer = null;
    var countdownTimer = null;
    var agentPrefilled = false;
    var roomExpiresAt = null;
    var roomCreatedAt = null;

    /* Owner detection: set during room creation in initHome */
    var isOwner = false;
    try {
      isOwner = !!localStorage.getItem('gander_creator_' + roomId);
    } catch (_) {}
    var ownerBadge = document.getElementById('owner-badge');
    if (ownerBadge && isOwner) ownerBadge.hidden = false;

    if (!roomId) {
      if (loadStatus) loadStatus.hidden = true;
      showError(loadErr, 'Missing room id in URL.');
      return;
    }

    /* ── Entry gate ── */
    var participantToken = null;
    var STORAGE_KEY = 'gander_token_' + roomId;
    var BASE_API = API_BASE;

    function storedToken() {
      try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
    }
    function storeToken(tok) {
      try { localStorage.setItem(STORAGE_KEY, tok); } catch (_) {}
    }
    function clearToken() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }

    function showGate() {
      var gate = document.getElementById('entry-gate');
      var sub  = document.getElementById('gate-sub');
      if (sub) sub.textContent = 'Room: ' + roomId;
      if (gate) gate.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function hideGate() {
      var gate = document.getElementById('entry-gate');
      if (gate) gate.hidden = true;
      document.body.style.overflow = '';
    }

    /* Wire gate form */
    (function wireGate() {
      var form     = document.getElementById('gate-form');
      var nameEl   = document.getElementById('gate-name');
      var emailEl  = document.getElementById('gate-email');
      var checkEl  = document.getElementById('gate-consent-check');
      var submitEl = document.getElementById('gate-submit');
      var errEl    = document.getElementById('gate-error');

      function validate() {
        var nameOk  = nameEl && nameEl.value.trim().length >= 2;
        var emailOk = emailEl && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim());
        var checked = checkEl && checkEl.checked;
        if (submitEl) submitEl.disabled = !(nameOk && emailOk && checked);
      }

      if (nameEl) nameEl.addEventListener('input', validate);
      if (emailEl) emailEl.addEventListener('input', validate);
      if (checkEl) checkEl.addEventListener('change', validate);

      if (form) {
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (submitEl) submitEl.disabled = true;
          if (errEl) errEl.hidden = true;
          var body = {
            full_name: nameEl ? nameEl.value.trim() : '',
            email: emailEl ? emailEl.value.trim() : '',
            terms_agreed: true,
          };
          fetch(BASE_API + '/' + encodeURIComponent(roomId) + '/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then(function (r) {
              return r.json().then(function (d) {
                if (!r.ok) throw new Error(d.error || r.statusText);
                return d;
              });
            })
            .then(function (data) {
              participantToken = data.participant_token;
              storeToken(participantToken);
              hideGate();
              loadRoom(false);
            })
            .catch(function (e) {
              if (errEl) { errEl.textContent = e.message || 'Failed to join room.'; errEl.hidden = false; }
              if (submitEl) submitEl.disabled = false;
            });
        });
      }
    })();

    /* Check if token already stored */
    var existingToken = storedToken();
    if (existingToken) {
      /* Verify it's still valid with a quick ping — just proceed and let write requests 401 if needed */
      participantToken = existingToken;
      loadRoom(false);
    } else {
      showGate();
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
      if (!silent || !replyFormOpen) {
        renderOffers(
          listEl,
          emptyEl,
          room.offers,
          room.room_id,
          room.status === 'closed',
          function () {
            loadRoom(true);
          },
        );
      }

      document.getElementById('offer-form-section').hidden = room.status === 'closed';

      var live = document.getElementById('live-pill');
      if (live) live.hidden = room.status === 'closed';

      var hint = document.getElementById('offers-sync-hint');
      if (hint) {
        hint.textContent =
          room.status === 'closed'
            ? 'This room is closed.'
            : 'Offers and replies refresh every few seconds. Terminal users can run curl on the plain-text feed.';
      }

      var aiPanel = document.getElementById('ai-panel');
      if (aiPanel) {
        if (room.negotiation_mode === 'ai' && room.status !== 'closed') {
          aiPanel.hidden = false;
          var cfg = room.strategy_config;
          var used = Number(room.ai_rounds_used) || 0;
          var maxR = cfg && cfg.max_rounds != null ? cfg.max_rounds : '?';
          var meta = document.getElementById('ai-panel-meta');
          if (meta) {
            meta.textContent =
              'Target ' +
              (cfg ? cfg.target_price : '?') +
              ' · Floor ' +
              (cfg ? cfg.walk_away_price : '?') +
              ' ' +
              (cfg && cfg.currency ? cfg.currency : '') +
              ' · AI-assisted rounds used: ' +
              used +
              ' / ' +
              maxR;
          }
          var agentEl = document.getElementById('agent');
          if (cfg && cfg.seller_agent_name && agentEl && !agentEl.value.trim() && !agentPrefilled) {
            agentEl.value = cfg.seller_agent_name;
            rememberAgent(cfg.seller_agent_name);
            agentPrefilled = true;
          }
        } else {
          aiPanel.hidden = true;
        }
      }

      /* ── Notes band ── */
      var notesBand = document.getElementById('room-notes-band');
      var notesText = document.getElementById('room-notes-text');
      if (notesBand && notesText) {
        if (room.notes) {
          notesText.textContent = room.notes;
          notesBand.hidden = false;
        } else {
          notesBand.hidden = true;
        }
      }

      /* ── Time limit band ── */
      var timerBand  = document.getElementById('room-timer-band');
      var timerValue = document.getElementById('room-timer-value');
      var timerBar   = document.getElementById('room-timer-bar');
      if (timerBand) {
        if (room.expires_at) {
          roomExpiresAt = room.expires_at;
          roomCreatedAt = room.created_at;
          timerBand.hidden = false;
          updateTimerDisplay(timerValue, timerBar, room.expires_at, room.created_at);
          /* Start countdown if not already running */
          if (!countdownTimer) {
            countdownTimer = window.setInterval(function () {
              var tv = document.getElementById('room-timer-value');
              var tb = document.getElementById('room-timer-bar');
              updateTimerDisplay(tv, tb, roomExpiresAt, roomCreatedAt);
            }, 1000);
          }
        } else {
          timerBand.hidden = true;
          if (countdownTimer) { window.clearInterval(countdownTimer); countdownTimer = null; }
        }
      }

      renderOfferStats(room.offers || []);

      if (!silent) {
        document.getElementById('load-section').hidden = true;
        document.getElementById('room-content').hidden = false;
        document.getElementById('offers-section').hidden = false;
      }
    }

    function updateTimerDisplay(timerValue, timerBar, expiresAt, createdAt) {
      if (!timerValue || !expiresAt) return;
      var now = Date.now();
      var exp = new Date(expiresAt).getTime();
      var diff = exp - now;
      if (diff <= 0) {
        timerValue.textContent = 'Expired';
        timerValue.style.color = 'var(--danger, #e55)';
        if (timerBar) timerBar.style.width = '0%';
        return;
      }
      var totalSec = Math.floor(diff / 1000);
      var h = Math.floor(totalSec / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      var parts = [];
      if (h) parts.push(h + 'h');
      if (m || h) parts.push(m + 'm');
      parts.push(s + 's');
      timerValue.textContent = parts.join(' ') + ' left';
      timerValue.style.color = '';
      if (timerBar && createdAt) {
        var start = new Date(createdAt).getTime();
        var total = exp - start;
        var pct = total > 0 ? Math.max(0, Math.min(100, (diff / total) * 100)) : 100;
        timerBar.style.width = pct.toFixed(1) + '%';
        timerBar.style.background = pct > 30
          ? 'var(--accent, #3b82f6)'
          : pct > 10
            ? 'var(--warn, #f59e0b)'
            : 'var(--danger, #e55)';
      }
    }

    function renderOfferStats(offers) {
      var card = document.getElementById('offer-stats-card');
      if (!card) return;

      var validOffers = offers.filter(function (o) {
        return o && o.price && typeof o.price.amount === 'number' && Number.isFinite(o.price.amount);
      });

      if (!validOffers.length) {
        card.hidden = true;
        return;
      }
      card.hidden = false;

      // Newest = last in array (chronological)
      var newest = validOffers[validOffers.length - 1];

      // Lowest and highest by amount
      var lowest = validOffers[0], highest = validOffers[0];
      for (var i = 1; i < validOffers.length; i++) {
        if (validOffers[i].price.amount < lowest.price.amount) lowest = validOffers[i];
        if (validOffers[i].price.amount > highest.price.amount) highest = validOffers[i];
      }

      function fmtPrice(o) {
        return String(o.price.amount) + (o.price.currency ? ' ' + o.price.currency : '');
      }
      function fmtMeta(o) {
        return (o.agent || '—') + (o.timestamp ? ' · ' + formatOfferTime(o.timestamp) : '');
      }

      document.getElementById('stat-newest').textContent = fmtPrice(newest);
      document.getElementById('stat-newest-meta').textContent = fmtMeta(newest);
      document.getElementById('stat-low').textContent = fmtPrice(lowest);
      document.getElementById('stat-low-meta').textContent = fmtMeta(lowest);
      document.getElementById('stat-high').textContent = fmtPrice(highest);
      document.getElementById('stat-high-meta').textContent = fmtMeta(highest);
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
        if (countdownTimer) window.clearInterval(countdownTimer);
      },
      false
    );

    var shareModal = document.getElementById('share-modal');
    var shareBtn = document.getElementById('share-btn');
    var shareText = document.getElementById('share-text');
    var shareCopyBtn = document.getElementById('share-copy-btn');
    var shareCopyStatus = document.getElementById('share-copy-status');

    function openShare() {
      if (shareText) shareText.value = buildShareText(roomId);
      if (shareModal) {
        shareModal.hidden = false;
        shareModal.setAttribute('aria-hidden', 'false');
      }
      if (shareCopyStatus) shareCopyStatus.hidden = true;
    }

    function closeShare() {
      if (shareModal) {
        shareModal.hidden = true;
        shareModal.setAttribute('aria-hidden', 'true');
      }
    }

    if (shareBtn) shareBtn.addEventListener('click', openShare);
    if (shareModal) {
      shareModal.querySelectorAll('[data-close-share]').forEach(function (el) {
        el.addEventListener('click', closeShare);
      });
    }
    if (shareCopyBtn && shareText) {
      shareCopyBtn.addEventListener('click', function () {
        var t = shareText.value;
        function done(msg) {
          if (shareCopyStatus) {
            shareCopyStatus.hidden = false;
            shareCopyStatus.textContent = msg;
          }
        }
        function fallback() {
          shareText.focus();
          shareText.select();
          shareText.setSelectionRange(0, 99999);
          try {
            if (document.execCommand('copy')) {
              done('Copied.');
              return;
            }
          } catch (_) {}
          done('Select the text and copy manually (Ctrl+C).');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(t)
            .then(function () {
              done('Copied.');
            })
            .catch(fallback);
        } else {
          fallback();
        }
      });
    }

    var aiSuggestErr = document.getElementById('ai-suggest-error');
    function showAiErr(msg) {
      if (!aiSuggestErr) return;
      aiSuggestErr.textContent = msg || '';
      aiSuggestErr.hidden = !msg;
    }
    void showAiErr;

    // Copy-room-id button
    var copyRoomIdBtn = document.getElementById('copy-room-id-btn');
    if (copyRoomIdBtn) {
      copyRoomIdBtn.addEventListener('click', function () {
        var txt = roomId;
        function done() { copyRoomIdBtn.textContent = 'copied!'; setTimeout(function () { copyRoomIdBtn.textContent = 'copy ID'; }, 1500); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(done);
        } else {
          done();
        }
      });
    }

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

      rememberAgent(agent);

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

      var offerHeaders = { 'Content-Type': 'application/json' };
      if (participantToken) offerHeaders['X-Participant-Token'] = participantToken;

      fetch(API_BASE + '/' + encodeURIComponent(roomId) + '/offer', {
        method: 'POST',
        headers: offerHeaders,
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
    initJoin();
  }
})();
