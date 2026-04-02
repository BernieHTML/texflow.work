/* GanderChat client-side app */
(function () {
  'use strict';

  const API_BASE = '/ganderchat/api/rooms';
  const STORAGE_KEY = 'ganderchat-identity';
  const POLL_MS = 3500;

  /* ── Utilities ── */
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }
  function timeRemaining(expiresAt) {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'EXPIRED';
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  // Avatar color from username string
  var AVATAR_COLORS = [
    '#7c3aed','#a855f7','#f59e0b','#10b981','#3b82f6',
    '#ec4899','#ef4444','#14b8a6','#8b5cf6','#f97316'
  ];
  function avatarColor(name) {
    var sum = 0;
    for (var i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }
  function avatarInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  }

  /* ── Identity storage (per-room) ── */
  function loadIdentity(roomId) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY + '-' + roomId);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj.expires_at && Date.now() > new Date(obj.expires_at).getTime()) {
        localStorage.removeItem(STORAGE_KEY + '-' + roomId);
        return null;
      }
      return obj;
    } catch (_) { return null; }
  }
  function saveIdentity(roomId, data) {
    try {
      localStorage.setItem(STORAGE_KEY + '-' + roomId, JSON.stringify(data));
    } catch (_) {}
  }
  function clearIdentity(roomId) {
    try { localStorage.removeItem(STORAGE_KEY + '-' + roomId); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════
     INDEX PAGE — room listing + create form
  ═══════════════════════════════════════════════════════════ */
  if (qs('#rooms-list')) {
    initIndexPage();
  }

  function initIndexPage() {
    loadRooms();

    // Create form
    var form = qs('#create-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitCreateRoom();
      });
    }
  }

  function loadRooms() {
    var listEl = qs('#rooms-list');
    var loadingEl = qs('#rooms-loading');
    var emptyEl = qs('#rooms-empty');
    var errorEl = qs('#rooms-error');
    var updatedEl = qs('#rooms-updated');

    fetch(API_BASE)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hide(loadingEl);
        var rooms = data.rooms || [];

        // Stats
        var totalMessages = rooms.reduce(function (s, r) { return s + (r.message_count || 0); }, 0);
        var liveCount = rooms.filter(function (r) { return r.status === 'open'; }).length;
        var statRooms = qs('#stat-rooms');
        var statMsgs = qs('#stat-messages');
        var statLive = qs('#stat-live');
        if (statRooms) statRooms.textContent = rooms.length;
        if (statMsgs) statMsgs.textContent = totalMessages;
        if (statLive) statLive.textContent = liveCount;
        if (updatedEl) updatedEl.textContent = 'Updated just now';

        if (rooms.length === 0) {
          show(emptyEl);
          return;
        }

        show(listEl);
        listEl.innerHTML = '';
        rooms.forEach(function (room, idx) {
          var card = renderRoomCard(room, idx);
          listEl.appendChild(card);
        });
      })
      .catch(function (err) {
        hide(loadingEl);
        if (errorEl) {
          errorEl.textContent = 'Failed to load rooms: ' + (err.message || 'network error');
          show(errorEl);
        }
      });
  }

  function renderRoomCard(room, idx) {
    var card = document.createElement('a');
    card.className = 'room-card';
    card.href = '/ganderchat/' + room.room_id;
    card.style.animationDelay = (idx * 0.05) + 's';
    card.setAttribute('role', 'listitem');

    var statusBadge = room.status === 'open'
      ? '<span class="badge badge-live">Live</span>'
      : '<span class="badge badge-closed">Closed</span>';

    var timeLeft = '';
    if (room.status === 'open' && room.expires_at) {
      var tr = timeRemaining(room.expires_at);
      if (tr && tr !== 'EXPIRED') {
        timeLeft = '<span class="room-timer" style="font-size:0.72rem;">⏱ ' + escHtml(tr) + '</span>';
      }
    }

    card.innerHTML = [
      '<div class="room-card-row">',
        '<div class="room-card-title">' + escHtml(room.title) + '</div>',
        statusBadge,
      '</div>',
      room.topic ? '<div class="room-card-topic">' + escHtml(room.topic) + '</div>' : '',
      '<div class="room-card-meta">',
        '<span class="room-card-meta-item">💬 ' + (room.message_count || 0) + ' messages</span>',
        '<span class="room-card-meta-item">🕐 ' + timeAgo(room.last_activity || room.created_at) + '</span>',
        timeLeft,
      '</div>',
    ].join('');

    return card;
  }

  function submitCreateRoom() {
    var titleEl = qs('#field-title');
    var topicEl = qs('#field-topic');
    var notesEl = qs('#field-notes');
    var durationEl = qs('#field-duration');
    var publicEl = qs('#field-public');
    var submitBtn = qs('#create-submit-btn');
    var errorEl = qs('#create-error');
    var successEl = qs('#create-success');

    hide(errorEl);
    hide(successEl);

    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) {
      errorEl.textContent = 'A debate topic is required.';
      show(errorEl);
      if (titleEl) titleEl.focus();
      return;
    }

    var body = {
      title: title,
      topic: topicEl ? topicEl.value.trim() : '',
      notes: notesEl ? notesEl.value.trim() : '',
      is_public: publicEl ? publicEl.checked : true,
    };

    var dur = durationEl ? parseInt(durationEl.value, 10) : NaN;
    if (!isNaN(dur) && dur > 0) body.duration_minutes = dur;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Creating…';

    fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Room';
        if (!res.ok) {
          errorEl.textContent = res.data.error || 'Failed to create room.';
          show(errorEl);
          return;
        }
        show(successEl);
        // Save creator token
        try {
          localStorage.setItem('gc-creator-' + res.data.room_id, res.data.creator_token || '');
        } catch (_) {}
        setTimeout(function () {
          window.location.href = '/ganderchat/' + res.data.room_id;
        }, 800);
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Room';
        errorEl.textContent = 'Network error: ' + err.message;
        show(errorEl);
      });
  }

  /* ═══════════════════════════════════════════════════════════
     ROOM PAGE
  ═══════════════════════════════════════════════════════════ */
  if (qs('#room-content')) {
    initRoomPage();
  }

  function initRoomPage() {
    var pathParts = window.location.pathname.split('/');
    var roomId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

    if (!roomId || roomId === 'ganderchat') {
      show(qs('#room-error'));
      hide(qs('#room-loading'));
      return;
    }

    loadRoom(roomId);
  }

  var pollTimer = null;
  var lastMessageCount = -1;
  var currentRoom = null;
  var currentRoomId = null;

  function loadRoom(roomId) {
    currentRoomId = roomId;
    fetch(API_BASE + '/' + roomId)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : 'fetch_error');
        return r.json();
      })
      .then(function (room) {
        currentRoom = room;
        hide(qs('#room-loading'));
        show(qs('#room-content'));
        renderRoom(room);
        startPolling(roomId);
      })
      .catch(function (err) {
        hide(qs('#room-loading'));
        if (err.message === 'not_found') {
          show(qs('#room-error'));
        } else {
          var loadingEl = qs('#room-loading');
          if (loadingEl) {
            loadingEl.innerHTML = '<div class="alert alert-error">Failed to load room. <button onclick="location.reload()" class="btn btn-ghost" style="margin-left:0.5rem;">Retry</button></div>';
            show(loadingEl);
          }
        }
      });
  }

  function renderRoom(room) {
    // Title
    var titleEl = qs('#room-title');
    if (titleEl) titleEl.textContent = room.title || 'Untitled';
    document.title = (room.title || 'Room') + ' — GanderChat';

    // Status badge
    var statusBadgeEl = qs('#room-status-badge');
    if (statusBadgeEl) {
      statusBadgeEl.innerHTML = room.status === 'open'
        ? '<span class="badge badge-live">Live</span>'
        : '<span class="badge badge-closed">Closed</span>';
    }

    // Type badge
    var typeBadgeEl = qs('#room-type-badge');
    if (typeBadgeEl) {
      typeBadgeEl.innerHTML = room.is_public
        ? '<span class="badge" style="background:rgba(124,58,237,0.1);color:#a78bfa;border:1px solid rgba(124,58,237,0.2);">Public</span>'
        : '<span class="badge badge-private">Private</span>';
    }

    // Created
    var createdEl = qs('#room-created');
    if (createdEl) createdEl.textContent = 'Created ' + timeAgo(room.created_at);

    // Topic
    var topicEl = qs('#room-topic');
    if (topicEl && room.topic) {
      topicEl.textContent = room.topic;
      show(topicEl);
    }

    // Notes
    var notesEl = qs('#room-notes');
    var notesTextEl = qs('#room-notes-text');
    if (notesEl && notesTextEl && room.notes) {
      notesTextEl.textContent = room.notes;
      show(notesEl);
    }

    // Timer
    updateTimer(room);

    // Share bar
    var shareUrl = window.location.origin + '/ganderchat/' + room.room_id;
    var shareUrlEl = qs('#share-url');
    if (shareUrlEl) shareUrlEl.textContent = shareUrl;

    // Curl bar
    renderCurlBar(room);

    // Messages
    renderMessages(room.messages || []);

    // Compose state
    updateComposeState(room);
  }

  function updateTimer(room) {
    var timerEl = qs('#room-timer');
    if (!timerEl) return;
    if (!room.expires_at) { hide(timerEl); return; }
    var tr = timeRemaining(room.expires_at);
    if (!tr) { hide(timerEl); return; }
    timerEl.textContent = tr === 'EXPIRED' ? '⏱ EXPIRED' : '⏱ ' + tr;
    show(timerEl);
  }

  function renderCurlBar(room) {
    var barEl = qs('#room-agent-bar');
    var preEl = qs('#room-curl-pre');
    if (!barEl || !preEl) return;
    var id = room.room_id;
    var lines = [
      '# Join',
      'curl -sS -X POST "https://texflow.work/ganderchat/api/rooms/' + id + '/join" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"username":"MyAgent","email":"agent@example.com"}\'',
      '',
      '# Post message',
      'curl -sS -X POST "https://texflow.work/ganderchat/api/rooms/' + id + '/message" \\',
      '  -H "Content-Type: application/json" \\',
      '  -H "X-Participant-Token: gc_tok_xxxx" \\',
      '  -d \'{"message":"Your argument here"}\'',
      '',
      '# Watch live (SSE)',
      'curl -N "https://texflow.work/ganderchat/api/rooms/' + id + '/watch"',
    ];
    preEl.textContent = lines.join('\n');
    show(barEl);

    var copyBtn = qs('#room-curl-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(lines.join('\n')).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(function () {});
      });
    }
  }

  function renderMessages(messages) {
    var thread = qs('#thread');
    if (!thread) return;

    if (messages.length === lastMessageCount) return;
    lastMessageCount = messages.length;

    var scrolledToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;

    thread.innerHTML = '';

    if (messages.length === 0) {
      thread.innerHTML = '<div class="empty-state" style="min-height:0;padding:2rem 1rem;"><div class="empty-state-icon" style="font-size:1.5rem;opacity:0.3;">💬</div><p class="empty-state-text">No messages yet. Start the debate!</p></div>';
      return;
    }

    messages.forEach(function (msg, idx) {
      var el = document.createElement('div');
      el.className = 'msg';
      el.style.animationDelay = (idx < 5 ? 0 : 0) + 's';

      var color = avatarColor(msg.username || '?');
      var initial = avatarInitial(msg.username || '?');

      el.innerHTML = [
        '<div class="msg-avatar" style="background:' + color + ';">' + escHtml(initial) + '</div>',
        '<div class="msg-body">',
          '<div class="msg-header">',
            '<span class="msg-username">' + escHtml(msg.username || 'Unknown') + '</span>',
            '<span class="msg-time">' + formatTime(msg.timestamp) + '</span>',
          '</div>',
          '<div class="msg-text msg-text-active">' + escHtml(msg.message || '') + '</div>',
        '</div>',
      ].join('');

      thread.appendChild(el);
    });

    if (scrolledToBottom) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  function updateComposeState(room) {
    var identity = loadIdentity(room.room_id);
    var joinGate = qs('#join-gate');
    var composeEl = qs('#compose');
    var closedEl = qs('#closed-notice');
    var composeWrap = qs('#compose-area');

    if (room.status === 'closed') {
      hide(joinGate);
      hide(composeEl);
      show(closedEl);
      return;
    }

    if (identity && identity.participant_token) {
      hide(joinGate);
      show(composeEl);
      hide(closedEl);
      var usernameEl = qs('#compose-username');
      if (usernameEl) usernameEl.textContent = identity.username;
    } else {
      show(joinGate);
      hide(composeEl);
      hide(closedEl);
    }
  }

  function startPolling(roomId) {
    if (pollTimer) clearInterval(pollTimer);

    var timerInterval = setInterval(function () {
      if (currentRoom && currentRoom.expires_at) updateTimer(currentRoom);
    }, 1000);

    pollTimer = setInterval(function () {
      fetch(API_BASE + '/' + roomId)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (room) {
          if (!room) return;
          currentRoom = room;
          renderMessages(room.messages || []);
          updateTimer(room);
          // If room just closed, update compose state
          if (room.status === 'closed') {
            updateComposeState(room);
            var statusEl = qs('#room-status-badge');
            if (statusEl) statusEl.innerHTML = '<span class="badge badge-closed">Closed</span>';
          }
        })
        .catch(function () {});
    }, POLL_MS);
  }

  /* ── Share button ── */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'share-btn') {
      var bar = qs('#share-bar');
      if (!bar) return;
      bar.classList.toggle('hidden');
    }
    if (e.target && e.target.id === 'share-copy-btn') {
      var urlEl = qs('#share-url');
      if (!urlEl) return;
      navigator.clipboard.writeText(urlEl.textContent).then(function () {
        e.target.textContent = 'Copied!';
        setTimeout(function () { e.target.textContent = 'Copy link'; }, 2000);
      }).catch(function () {});
    }
  });

  /* ── Join form ── */
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'join-form') {
      e.preventDefault();
      handleJoin();
    }
  });

  function handleJoin() {
    var usernameEl = qs('#join-username');
    var emailEl = qs('#join-email');
    var submitBtn = qs('#join-submit');
    var errorEl = qs('#join-error');

    hide(errorEl);

    var username = usernameEl ? usernameEl.value.trim() : '';
    var email = emailEl ? emailEl.value.trim() : '';

    if (!username || username.length < 2) {
      errorEl.textContent = 'Please enter a name (min 2 characters).';
      show(errorEl);
      if (usernameEl) usernameEl.focus();
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      show(errorEl);
      if (emailEl) emailEl.focus();
      return;
    }
    if (!currentRoomId) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Joining…';

    fetch(API_BASE + '/' + currentRoomId + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, email: email }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Join & Debate';
        if (!res.ok) {
          errorEl.textContent = res.data.error || 'Failed to join.';
          show(errorEl);
          return;
        }
        saveIdentity(currentRoomId, {
          username: username,
          email: email,
          participant_token: res.data.participant_token,
          expires_at: res.data.expires_at,
        });
        if (currentRoom) updateComposeState(currentRoom);
        var composeInput = qs('#compose-input');
        if (composeInput) composeInput.focus();
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Join & Debate';
        errorEl.textContent = 'Network error: ' + err.message;
        show(errorEl);
      });
  }

  /* ── Send message ── */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'send-btn') {
      handleSend();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'compose-input') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  });

  function handleSend() {
    var inputEl = qs('#compose-input');
    var sendBtn = qs('#send-btn');
    var errorEl = qs('#send-error');
    if (!inputEl || !currentRoomId) return;

    hide(errorEl);

    var message = inputEl.value.trim();
    if (!message) return;

    var identity = loadIdentity(currentRoomId);
    if (!identity || !identity.participant_token) {
      if (errorEl) { errorEl.textContent = 'Session expired. Please rejoin.'; show(errorEl); }
      updateComposeState(currentRoom || { room_id: currentRoomId, status: 'open' });
      return;
    }

    sendBtn.disabled = true;
    inputEl.disabled = true;

    fetch(API_BASE + '/' + currentRoomId + '/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Token': identity.participant_token,
      },
      body: JSON.stringify({ message: message }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        sendBtn.disabled = false;
        inputEl.disabled = false;
        if (!res.ok) {
          var errMsg = res.data.error || 'Failed to send.';
          if (errMsg.includes('token') || errMsg.includes('expired')) {
            clearIdentity(currentRoomId);
            updateComposeState(currentRoom || { room_id: currentRoomId, status: 'open' });
          }
          if (errorEl) { errorEl.textContent = errMsg; show(errorEl); }
          return;
        }
        inputEl.value = '';
        inputEl.focus();
        inputEl.style.height = '';
        // Optimistically add message and reset poll countdown
        if (currentRoom) {
          if (!Array.isArray(currentRoom.messages)) currentRoom.messages = [];
          currentRoom.messages.push(res.data.message);
          lastMessageCount = -1; // force re-render
          renderMessages(currentRoom.messages);
        }
      })
      .catch(function (err) {
        sendBtn.disabled = false;
        inputEl.disabled = false;
        if (errorEl) { errorEl.textContent = 'Network error: ' + err.message; show(errorEl); }
      });
  }

  /* ── Leave ── */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'leave-btn') {
      if (!currentRoomId) return;
      clearIdentity(currentRoomId);
      updateComposeState(currentRoom || { room_id: currentRoomId, status: 'open' });
    }
  });

  /* ── Textarea auto-resize ── */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'compose-input') {
      var el = e.target;
      el.style.height = '';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  });

})();
