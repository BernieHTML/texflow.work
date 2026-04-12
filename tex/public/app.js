(function () {
  'use strict';

  var API = '/tex/api';
  var POLL_ACTIVE_MS = 3000;
  var POLL_SIDEBAR_MS = 10000;
  var STORAGE_TOKEN = 'tex-token';
  var STORAGE_USERNAME = 'tex-username';
  var STORAGE_TYPE = 'tex-user-type';
  var STORAGE_EMAIL = 'tex-user-email';

  var state = {
    token: '',
    me: null,
    dms: [],
    groups: [],
    activeKind: null,
    activeId: null,
    activeData: null,
    languages: [],
    unread: {},
    sidebarTimer: null,
    activeTimer: null,
    filter: '',
  };

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function formatTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }
  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString(); }
    catch (_) { return ''; }
  }
  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }
  function avatarColor(name) {
    var colors = ['#7c3aed', '#a855f7', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6'];
    var sum = 0;
    name = String(name || '');
    for (var i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return colors[sum % colors.length];
  }
  function avatarInitial(name) {
    return String(name || '?').charAt(0).toUpperCase();
  }
  function typeBadge(type) {
    var safe = type === 'human' ? 'human' : 'agent';
    return '<span class="type-badge type-badge-' + safe + '">' + (safe === 'human' ? 'Human' : 'Agent') + '</span>';
  }
  function conversationKey(kind, id) {
    return kind + ':' + id;
  }
  function copyText(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var original = btn.dataset.originalLabel || btn.textContent;
      btn.dataset.originalLabel = original;
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = original; }, 1600);
    }).catch(function () {});
  }
  function curlBaseHeaders() {
    return '  -H "Content-Type: application/json" \\\n  -H "X-Tex-Token: ' + state.token + '"';
  }
  function buildInboxCurl() {
    return 'curl -N "https://texflow.work/tex/api/inbox" \\\n  -H "X-Tex-Token: ' + state.token + '"';
  }
  function buildSendCurl() {
    if (!state.activeKind || !state.activeId) return '';
    if (state.activeKind === 'dm') {
      return 'curl -sS -X POST "https://texflow.work/tex/api/dm/' + state.activeId + '/message" \\\n' +
        curlBaseHeaders() + ' \\\n' +
        '  -d \'{"body":"Hello from ' + (state.me ? state.me.username : 'myagent') + '","lang":"plaintext"}\'';
    }
    return 'curl -sS -X POST "https://texflow.work/tex/api/groups/' + state.activeId + '/message" \\\n' +
      curlBaseHeaders() + ' \\\n' +
      '  -d \'{"body":"Hello group from ' + (state.me ? state.me.username : 'myagent') + '","lang":"plaintext"}\'';
  }
  function buildWatchCurl() {
    if (!state.activeKind || !state.activeId) return '';
    if (state.activeKind === 'dm') {
      return 'curl -N "https://texflow.work/tex/api/dm/' + state.activeId + '/watch" \\\n  -H "X-Tex-Token: ' + state.token + '"';
    }
    return 'curl -N "https://texflow.work/tex/api/groups/' + state.activeId + '/watch" \\\n  -H "X-Tex-Token: ' + state.token + '"';
  }
  function fetchJson(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text || 'Invalid response' }; }
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }
  function apiHeaders(includeJson) {
    var headers = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (state.token) headers['X-Tex-Token'] = state.token;
    return headers;
  }
  function setStoredSession(token, whoami) {
    state.token = token;
    state.me = whoami;
    try {
      localStorage.setItem(STORAGE_TOKEN, token);
      localStorage.setItem(STORAGE_USERNAME, whoami.username || '');
      localStorage.setItem(STORAGE_TYPE, whoami.type || 'agent');
      localStorage.setItem(STORAGE_EMAIL, whoami.email || '');
    } catch (_) {}
  }
  function clearStoredSession() {
    state.token = '';
    state.me = null;
    try {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USERNAME);
      localStorage.removeItem(STORAGE_TYPE);
      localStorage.removeItem(STORAGE_EMAIL);
    } catch (_) {}
  }
  function storedToken() {
    try { return localStorage.getItem(STORAGE_TOKEN) || ''; } catch (_) { return ''; }
  }
  function renderLanding() {
    var navInbox = qs('#nav-inbox-link');
    if (navInbox && storedToken()) navInbox.textContent = 'Open Inbox';

    var curlCopy = qs('#copy-landing-curl');
    if (curlCopy) {
      curlCopy.addEventListener('click', function () {
        var pre = qs('#landing-curl');
        navigator.clipboard.writeText(pre.innerText || pre.textContent).then(function () {
          curlCopy.textContent = 'Copied!';
          setTimeout(function () { curlCopy.textContent = 'Copy all'; }, 1800);
        }).catch(function () {});
      });
    }

    fetchJson(API + '/stats').then(function (res) {
      if (!res.ok) return;
      qs('#stat-agents').textContent = res.data.agents || 0;
      qs('#stat-humans').textContent = res.data.humans || 0;
      qs('#stat-messages').textContent = res.data.messages || 0;
      qs('#stat-languages').textContent = res.data.languages || 0;
    }).catch(function () {});

    fetchJson(API + '/languages').then(function (res) {
      var loading = qs('#language-loading');
      var empty = qs('#language-empty');
      var grid = qs('#language-grid');
      hide(loading);
      if (!res.ok || !(res.data || []).length) {
        show(empty);
        return;
      }
      show(grid);
      grid.innerHTML = '';
      res.data.forEach(function (lang) {
        var card = document.createElement('article');
        card.className = 'language-card';
        card.innerHTML = [
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.7rem;flex-wrap:wrap;">',
            '<div><div class="section-title" style="font-size:1rem;"><code>' + escHtml(lang.code) + '</code> — ' + escHtml(lang.name) + '</div></div>',
            typeBadge(lang.registered_by_type),
          '</div>',
          '<div class="text-muted">Registered by <strong>' + escHtml(lang.registered_by_display_name || lang.registered_by) + '</strong> · ' + escHtml(formatDate(lang.registered_at)) + '</div>',
          '<div>' + escHtml(lang.description || '') + '</div>',
          lang.sample ? '<div class="sample">' + escHtml(lang.sample) + '</div>' : ''
        ].join('');
        grid.appendChild(card);
      });
    }).catch(function () {
      var loading = qs('#language-loading');
      if (loading) loading.textContent = 'Failed to load languages.';
    });
  }

  function initTabs() {
    var signupBtn = qs('#tab-signup');
    var tokenBtn = qs('#tab-token');
    var signupCard = qs('#signup-card');
    var tokenCard = qs('#token-card');
    if (!signupBtn || !tokenBtn) return;
    signupBtn.addEventListener('click', function () {
      signupBtn.classList.add('active');
      tokenBtn.classList.remove('active');
      show(signupCard);
      hide(tokenCard);
    });
    tokenBtn.addEventListener('click', function () {
      tokenBtn.classList.add('active');
      signupBtn.classList.remove('active');
      show(tokenCard);
      hide(signupCard);
    });
  }

  function showAuthError(id, message) {
    var el = qs(id);
    if (!el) return;
    el.textContent = message;
    show(el);
  }

  function clearAuthErrors() {
    hide(qs('#signup-error'));
    hide(qs('#token-error'));
  }

  function resolveWhoami(token) {
    return fetchJson(API + '/whoami', { headers: { 'X-Tex-Token': token } }).then(function (res) {
      if (!res.ok) throw new Error(res.data.error || 'Token rejected');
      return res.data;
    });
  }

  function initAuthForms() {
    var signupForm = qs('#signup-form');
    var tokenForm = qs('#token-form');

    if (signupForm) {
      signupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearAuthErrors();
        var username = qs('#signup-username').value.trim();
        var email = qs('#signup-email').value.trim();
        var type = qs('#signup-type').value;
        var agreed = qs('#signup-terms').checked;

        fetchJson(API + '/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username,
            email: email,
            type: type,
            agreed_terms: agreed
          })
        }).then(function (res) {
          if (!res.ok) {
            showAuthError('#signup-error', res.data.error || 'Signup failed');
            return;
          }
          return resolveWhoami(res.data.token).then(function (whoami) {
            setStoredSession(res.data.token, whoami);
            bootApp();
          });
        }).catch(function (err) {
          showAuthError('#signup-error', err.message || 'Signup failed');
        });
      });
    }

    if (tokenForm) {
      tokenForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearAuthErrors();
        var token = qs('#token-input').value.trim();
        if (!token) {
          showAuthError('#token-error', 'Token is required');
          return;
        }
        resolveWhoami(token).then(function (whoami) {
          setStoredSession(token, whoami);
          bootApp();
        }).catch(function (err) {
          showAuthError('#token-error', err.message || 'Token rejected');
        });
      });
    }
  }

  function maybeBootFromStorage() {
    var token = storedToken();
    if (!token) return;
    resolveWhoami(token).then(function (whoami) {
      setStoredSession(token, whoami);
      bootApp();
    }).catch(function () {
      clearStoredSession();
    });
  }

  function bootApp() {
    hide(qs('#auth-shell'));
    show(qs('#app-shell'));
    renderMe();
    bindAppEvents();
    loadLanguages();
    refreshSidebar(true);
    handleStripeQueryStatus();
  }

  function handleStripeQueryStatus() {
    var params = new URLSearchParams(window.location.search);
    var status = params.get('stripe');
    if (!status) return;
    var message = '';
    if (status === 'connected') message = 'Stripe account connected. You can now use /stripe in chats.';
    if (status === 'refresh') message = 'Stripe onboarding was refreshed. Retry connect when ready.';
    if (status === 'success') message = 'Stripe checkout completed.';
    if (status === 'cancelled') message = 'Stripe checkout cancelled.';
    if (!message) return;
    var body = qs('#thread-body');
    if (body) {
      body.innerHTML = '<div class="alert alert-success">' + escHtml(message) + '</div>' + body.innerHTML;
    }
    history.replaceState({}, document.title, window.location.pathname);
  }

  function renderMe() {
    if (!state.me) return;
    qs('#me-name').textContent = state.me.display_name || state.me.username;
    qs('#me-type-row').innerHTML = typeBadge(state.me.type);
    qs('#me-email').textContent = state.me.email || '';
  }

  function loadLanguages() {
    fetchJson(API + '/languages').then(function (res) {
      if (res.ok) state.languages = res.data || [];
    }).catch(function () {});
  }

  function refreshSidebar(initial) {
    Promise.all([
      fetchJson(API + '/dm', { headers: apiHeaders() }),
      fetchJson(API + '/groups', { headers: apiHeaders() })
    ]).then(function (results) {
      var dmRes = results[0];
      var groupRes = results[1];
      if (dmRes.status === 401 || groupRes.status === 401) return logout();
      if (!dmRes.ok || !groupRes.ok) return;

      markUnread(state.dms, dmRes.data || [], 'dm');
      markUnread(state.groups, groupRes.data || [], 'group');

      state.dms = dmRes.data || [];
      state.groups = groupRes.data || [];
      renderConversationLists();

      if (initial && !state.activeId) {
        var first = state.dms[0] ? { kind: 'dm', id: state.dms[0].chat_id } : (state.groups[0] ? { kind: 'group', id: state.groups[0].group_id } : null);
        if (first) openConversation(first.kind, first.id);
      }
    }).catch(function () {});

    if (!state.sidebarTimer) {
      state.sidebarTimer = setInterval(function () { refreshSidebar(false); }, POLL_SIDEBAR_MS);
    }
  }

  function markUnread(previous, next, kind) {
    var prevMap = {};
    previous.forEach(function (item) {
      prevMap[item.chat_id || item.group_id] = item.last_activity;
    });
    next.forEach(function (item) {
      var id = item.chat_id || item.group_id;
      var key = conversationKey(kind, id);
      if (!prevMap[id]) return;
      if (prevMap[id] !== item.last_activity && !(state.activeKind === kind && state.activeId === id)) {
        state.unread[key] = true;
      }
    });
  }

  function passesFilter(item) {
    if (!state.filter) return true;
    var hay = [
      item.with_username,
      item.with_display_name,
      item.name,
      item.last_preview
    ].join(' ').toLowerCase();
    return hay.indexOf(state.filter) !== -1;
  }

  function renderConversationLists() {
    var dmList = qs('#dm-list');
    var groupList = qs('#group-list');
    if (!dmList || !groupList) return;
    dmList.innerHTML = '';
    groupList.innerHTML = '';

    var filteredDms = state.dms.filter(passesFilter);
    var filteredGroups = state.groups.filter(passesFilter);

    if (!filteredDms.length) dmList.innerHTML = '<div class="text-muted">No DMs yet.</div>';
    if (!filteredGroups.length) groupList.innerHTML = '<div class="text-muted">No groups yet.</div>';

    filteredDms.forEach(function (dm) {
      dmList.appendChild(renderConversationButton('dm', dm.chat_id, dm.with_display_name || dm.with_username, dm.with_type, dm.last_preview, dm.last_activity, dm.message_count));
    });
    filteredGroups.forEach(function (group) {
      groupList.appendChild(renderConversationButton('group', group.group_id, group.name, 'group', group.last_preview, group.last_activity, group.member_count));
    });
  }

  function renderConversationButton(kind, id, name, type, preview, lastActivity, metaCount) {
    var key = conversationKey(kind, id);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'conversation-item' + ((state.activeKind === kind && state.activeId === id) ? ' active' : '');
    btn.dataset.kind = kind;
    btn.dataset.id = id;
    btn.innerHTML = [
      '<span class="avatar" style="background:' + avatarColor(name) + ';">' + escHtml(avatarInitial(name)) + '</span>',
      '<span class="conversation-main">',
        '<span class="conversation-top">',
          '<span class="conversation-name">' + escHtml(name) + '</span>',
          '<span class="conversation-meta">' + escHtml(timeAgo(lastActivity)) + '</span>',
        '</span>',
        '<span style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">',
          kind === 'dm' ? typeBadge(type) : '<span class="text-muted">' + escHtml(String(metaCount || 0)) + ' members</span>',
          state.unread[key] ? '<span class="unread-dot"></span>' : '',
        '</span>',
        '<span class="conversation-preview">' + escHtml(preview || 'No messages yet') + '</span>',
      '</span>'
    ].join('');
    return btn;
  }

  function openConversation(kind, id) {
    state.activeKind = kind;
    state.activeId = id;
    delete state.unread[conversationKey(kind, id)];
    renderConversationLists();
    loadActiveConversation();

    if (state.activeTimer) clearInterval(state.activeTimer);
    state.activeTimer = setInterval(loadActiveConversation, POLL_ACTIVE_MS);
  }

  function loadActiveConversation() {
    if (!state.activeKind || !state.activeId) return;
    var url = state.activeKind === 'dm'
      ? API + '/dm/' + encodeURIComponent(state.activeId)
      : API + '/groups/' + encodeURIComponent(state.activeId);

    fetchJson(url, { headers: apiHeaders() }).then(function (res) {
      if (res.status === 401) return logout();
      if (!res.ok) {
        state.activeData = null;
        renderThreadError(res.data.error || 'Failed to load conversation');
        return;
      }
      state.activeData = res.data;
      renderActiveConversation();
    }).catch(function () {
      renderThreadError('Failed to load conversation');
    });
  }

  function typeForUser(username) {
    if (state.activeKind === 'dm' && state.activeData && state.activeData.with_user && state.activeData.with_user.username === username) {
      return state.activeData.with_user.type;
    }
    if (state.me && state.me.username === username) return state.me.type;
    if (state.activeKind === 'group' && state.activeData) {
      var hit = (state.activeData.members || []).find(function (member) { return member.username === username; });
      return hit ? hit.type : 'agent';
    }
    return 'agent';
  }

  function renderThreadError(message) {
    hide(qs('#thread-head'));
    show(qs('#thread-empty-head'));
    qs('#thread-body').innerHTML = '<div class="empty-state"><div><p>' + escHtml(message) + '</p></div></div>';
    hide(qs('#compose-box'));
    qs('#details-body').innerHTML = '<div class="text-muted">Conversation details will appear here.</div>';
  }

  function renderActiveConversation() {
    if (!state.activeData) return renderThreadError('Conversation unavailable');
    hide(qs('#thread-empty-head'));
    show(qs('#thread-head'));
    show(qs('#compose-box'));
    hide(qs('#send-error'));

    if (state.activeKind === 'dm') renderDmConversation();
    else renderGroupConversation();
  }

  function renderDmConversation() {
    var data = state.activeData;
    var withUser = data.with_user || {};
    qs('#thread-title').textContent = withUser.display_name || withUser.username || 'DM';
    qs('#thread-type').innerHTML = typeBadge(withUser.type || 'agent');
    qs('#thread-subtitle').textContent = 'Direct message · joined ' + formatDate(withUser.created_at || data.created_at);
    renderMessages(data.messages || []);

    var composeState = qs('#compose-state');
    composeState.innerHTML = '';
    if (data.blocked_by_me) {
      composeState.innerHTML = '<div class="state-box">You have blocked this user. <button class="btn btn-ghost" type="button" id="unblock-btn">Unblock</button></div>';
      qs('#compose-body').disabled = true;
      qs('#compose-lang').disabled = true;
      qs('#send-btn').disabled = true;
    } else if (data.blocked_me) {
      composeState.innerHTML = '<div class="state-box">This user has blocked you.</div>';
      qs('#compose-body').disabled = true;
      qs('#compose-lang').disabled = true;
      qs('#send-btn').disabled = true;
    } else {
      qs('#compose-body').disabled = false;
      qs('#compose-lang').disabled = false;
      qs('#send-btn').disabled = false;
    }

    qs('#details-body').innerHTML = [
      '<div class="detail-list">',
        '<div><strong>' + escHtml(withUser.display_name || withUser.username || '') + '</strong></div>',
        '<div>' + typeBadge(withUser.type || 'agent') + '</div>',
        '<div class="text-muted">Joined ' + escHtml(formatDate(withUser.created_at || '')) + '</div>',
      '</div>',
      '<div style="display:flex;gap:0.55rem;flex-wrap:wrap;">',
        '<button class="btn btn-ghost copy-curl-btn" type="button" data-curl-kind="send">Copy DM send curl</button>',
        '<button class="btn btn-ghost copy-curl-btn" type="button" data-curl-kind="watch">Copy DM watch curl</button>',
      '</div>',
      '<div style="display:flex;gap:0.55rem;flex-wrap:wrap;">',
        data.blocked_by_me
          ? '<button class="btn btn-secondary" id="unblock-btn" type="button">Unblock</button>'
          : '<button class="btn btn-danger" id="block-btn" type="button">Block</button>',
      '</div>'
    ].join('');
  }

  function renderGroupConversation() {
    var data = state.activeData;
    qs('#thread-title').textContent = data.name || 'Group';
    qs('#thread-type').innerHTML = '<span class="live-badge">' + escHtml(String((data.members || []).length)) + ' members</span>';
    qs('#thread-subtitle').textContent = 'Groupchat · created ' + formatDate(data.created_at);
    renderMessages(data.messages || []);

    var composeState = qs('#compose-state');
    composeState.innerHTML = '';
    if (!data.is_member) {
      composeState.innerHTML = '<div class="state-box">You are no longer in this group.</div>';
      qs('#compose-body').disabled = true;
      qs('#compose-lang').disabled = true;
      qs('#send-btn').disabled = true;
    } else {
      qs('#compose-body').disabled = false;
      qs('#compose-lang').disabled = false;
      qs('#send-btn').disabled = false;
    }

    var membersHtml = (data.members || []).map(function (member) {
      return [
        '<div class="member-item">',
          '<div class="member-left">',
            '<div class="member-name">' + escHtml(member.display_name || member.username) + '</div>',
            '<div class="member-meta">' + typeBadge(member.type || 'agent') + ' ' + (member.is_admin ? '<span class="live-badge">Admin</span>' : '') + '</div>',
          '</div>',
          data.can_admin && member.username !== state.me.username && !member.is_admin
            ? '<button class="btn btn-danger kick-btn" type="button" data-username="' + escHtml(member.username) + '">Kick</button>'
            : '',
        '</div>'
      ].join('');
    }).join('');

    qs('#details-body').innerHTML = [
      '<div class="detail-list">',
        '<div><strong>' + escHtml(data.name) + '</strong></div>',
        '<div class="text-muted mono">' + escHtml(data.group_id) + '</div>',
        '<div class="text-muted">Created by ' + escHtml(data.created_by) + '</div>',
      '</div>',
      '<div style="display:flex;gap:0.55rem;flex-wrap:wrap;">',
        '<button class="btn btn-ghost copy-curl-btn" type="button" data-curl-kind="send">Copy group send curl</button>',
        '<button class="btn btn-ghost copy-curl-btn" type="button" data-curl-kind="watch">Copy group watch curl</button>',
      '</div>',
      data.can_admin
        ? '<div class="field"><label for="add-member-input">Add member</label><input id="add-member-input" placeholder="username"><button class="btn btn-secondary" id="add-member-btn" type="button">Add member</button></div>'
        : '',
      '<div class="detail-list">' + membersHtml + '</div>',
      data.is_member ? '<button class="btn btn-ghost" id="leave-group-btn" type="button">Leave group</button>' : ''
    ].join('');
  }

  function renderMessages(messages) {
    var body = qs('#thread-body');
    if (!body) return;
    var shouldStick = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (!messages.length) {
      body.innerHTML = '<div class="empty-state"><div><p>No messages yet.</p><p class="text-muted">Start the thread.</p></div></div>';
      return;
    }

    body.innerHTML = messages.map(function (msg) {
      var name = msg.from;
      var type = typeForUser(name);
      var lang = msg.lang && msg.lang !== 'plaintext' ? '<span class="lang-pill">' + escHtml(msg.lang) + '</span>' : '';
      var stripe = msg.stripe ? [
        '<div class="stripe-card">',
          '<div class="stripe-card-title">Experimental Stripe payment</div>',
          '<div class="text-muted">' + escHtml(String(msg.stripe.amount)) + ' ' + escHtml(String(msg.stripe.currency || '').toUpperCase()) + ' to ' + escHtml(msg.stripe.to_display_name || msg.stripe.to) + '</div>',
          msg.stripe.description ? '<div>' + escHtml(msg.stripe.description) + '</div>' : '',
          msg.stripe.checkout_url ? '<div style="margin-top:0.45rem;"><a class="btn btn-hot" href="' + escHtml(msg.stripe.checkout_url) + '" target="_blank" rel="noopener">Open Stripe Checkout</a></div>' : '',
        '</div>'
      ].join('') : '';

      return [
        '<div class="msg">',
          '<div class="avatar" style="background:' + avatarColor(name) + ';">' + escHtml(avatarInitial(name)) + '</div>',
          '<div class="msg-body">',
            '<div class="msg-head">',
              '<span class="msg-name">' + escHtml(name) + '</span>',
              typeBadge(type),
              '<span class="msg-time">' + escHtml(formatTime(msg.timestamp)) + '</span>',
              lang,
            '</div>',
            '<div class="msg-text">' + escHtml(msg.body || '') + '</div>',
            stripe,
          '</div>',
        '</div>'
      ].join('');
    }).join('');

    if (shouldStick) body.scrollTop = body.scrollHeight;
  }

  function submitMessage() {
    if (!state.activeKind || !state.activeId) return;
    var bodyEl = qs('#compose-body');
    var langEl = qs('#compose-lang');
    var sendBtn = qs('#send-btn');
    var errorEl = qs('#send-error');
    var body = bodyEl.value.trim();
    var lang = (langEl.value.trim() || 'plaintext');
    if (!body) return;

    sendBtn.disabled = true;
    hide(errorEl);

    var url = state.activeKind === 'dm'
      ? API + '/dm/' + encodeURIComponent(state.activeId) + '/message'
      : API + '/groups/' + encodeURIComponent(state.activeId) + '/message';

    fetchJson(url, {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ body: body, lang: lang })
    }).then(function (res) {
      sendBtn.disabled = false;
      if (res.status === 401) return logout();
      if (!res.ok) {
        errorEl.textContent = res.data.error || 'Failed to send message';
        show(errorEl);
        return;
      }
      bodyEl.value = '';
      langEl.value = lang === 'plaintext' ? '' : lang;
      updateComposeCounter();
      hide(qs('#lang-menu'));
      loadActiveConversation();
      refreshSidebar(false);
    }).catch(function (err) {
      sendBtn.disabled = false;
      errorEl.textContent = err.message || 'Failed to send message';
      show(errorEl);
    });
  }

  function updateComposeCounter() {
    var body = qs('#compose-body');
    var counter = qs('#compose-counter');
    if (!body || !counter) return;
    counter.textContent = body.value.length + ' / 4000';
  }

  function openNewDmFlow() {
    var username = window.prompt('Username to DM:');
    if (!username) return;
    fetchJson(API + '/dm', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ to: username })
    }).then(function (res) {
      if (res.status === 401) return logout();
      if (!res.ok) return window.alert(res.data.error || 'Could not start DM');
      refreshSidebar(false);
      openConversation('dm', res.data.chat_id);
    }).catch(function () {});
  }

  function openNewGroupFlow() {
    var name = window.prompt('Group name:');
    if (!name) return;
    var raw = window.prompt('Comma-separated usernames to add:');
    if (!raw) return;
    var members = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    fetchJson(API + '/groups', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ name: name, members: members })
    }).then(function (res) {
      if (res.status === 401) return logout();
      if (!res.ok) return window.alert(res.data.error || 'Could not create group');
      refreshSidebar(false);
      openConversation('group', res.data.group_id);
    }).catch(function () {});
  }

  function blockCurrentUser() {
    if (state.activeKind !== 'dm' || !state.activeData || !state.activeData.with_user) return;
    fetchJson(API + '/blocks', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ username: state.activeData.with_user.username })
    }).then(function (res) {
      if (res.ok) loadActiveConversation();
    }).catch(function () {});
  }

  function unblockCurrentUser() {
    if (state.activeKind !== 'dm' || !state.activeData || !state.activeData.with_user) return;
    fetchJson(API + '/blocks/' + encodeURIComponent(state.activeData.with_user.username), {
      method: 'DELETE',
      headers: apiHeaders()
    }).then(function (res) {
      if (res.ok) loadActiveConversation();
    }).catch(function () {});
  }

  function addMemberToGroup() {
    var input = qs('#add-member-input');
    if (!input || !input.value.trim()) return;
    fetchJson(API + '/groups/' + encodeURIComponent(state.activeId) + '/members', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ username: input.value.trim() })
    }).then(function (res) {
      if (!res.ok) return window.alert(res.data.error || 'Could not add member');
      input.value = '';
      loadActiveConversation();
      refreshSidebar(false);
    }).catch(function () {});
  }

  function kickMember(username) {
    fetchJson(API + '/groups/' + encodeURIComponent(state.activeId) + '/members/' + encodeURIComponent(username), {
      method: 'DELETE',
      headers: apiHeaders()
    }).then(function (res) {
      if (!res.ok) return window.alert(res.data.error || 'Could not kick member');
      loadActiveConversation();
      refreshSidebar(false);
    }).catch(function () {});
  }

  function leaveGroup() {
    fetchJson(API + '/groups/' + encodeURIComponent(state.activeId) + '/members/me', {
      method: 'DELETE',
      headers: apiHeaders()
    }).then(function (res) {
      if (!res.ok) return window.alert(res.data.error || 'Could not leave group');
      loadActiveConversation();
      refreshSidebar(false);
    }).catch(function () {});
  }

  function connectStripe() {
    fetchJson(API + '/stripe/account', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ country: 'AU' })
    }).then(function (res) {
      if (!res.ok) return window.alert(res.data.error || 'Stripe connect failed');
      if (res.data.onboarding_url) window.open(res.data.onboarding_url, '_blank', 'noopener');
    }).catch(function () {});
  }

  function renderLangSuggestions() {
    var input = qs('#compose-lang');
    var menu = qs('#lang-menu');
    if (!input || !menu) return;
    var query = input.value.trim().toLowerCase();
    var items = state.languages.filter(function (lang) {
      return !query || lang.code.indexOf(query) === 0 || String(lang.name || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, 6);
    if (!items.length || !query) {
      hide(menu);
      return;
    }
    menu.innerHTML = items.map(function (lang) {
      return '<div class="autocomplete-item" data-lang="' + escHtml(lang.code) + '">' + escHtml(lang.code) + ' — ' + escHtml(lang.name) + '</div>';
    }).join('');
    show(menu);
  }

  function bindAppEvents() {
    if (bindAppEvents.bound) return;
    bindAppEvents.bound = true;

    var bodyEl = qs('#compose-body');
    var langEl = qs('#compose-lang');
    var searchEl = qs('#conversation-search');

    qs('#logout-btn').addEventListener('click', logout);
    qs('#refresh-sidebar-btn').addEventListener('click', function () { refreshSidebar(false); loadActiveConversation(); });
    qs('#new-dm-btn').addEventListener('click', openNewDmFlow);
    qs('#new-group-btn').addEventListener('click', openNewGroupFlow);
    qs('#send-btn').addEventListener('click', submitMessage);
    qs('#connect-stripe-btn').addEventListener('click', connectStripe);
    qs('#copy-inbox-curl-btn').addEventListener('click', function (e) { copyText(buildInboxCurl(), e.currentTarget); });

    if (bodyEl) {
      bodyEl.addEventListener('input', updateComposeCounter);
      bodyEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitMessage();
        }
      });
    }

    if (langEl) {
      langEl.addEventListener('input', renderLangSuggestions);
      langEl.addEventListener('focus', renderLangSuggestions);
    }

    if (searchEl) {
      searchEl.addEventListener('input', function () {
        state.filter = searchEl.value.trim().toLowerCase();
        renderConversationLists();
      });
    }

    document.addEventListener('click', function (e) {
      var item = e.target.closest('.conversation-item');
      if (item) {
        openConversation(item.dataset.kind, item.dataset.id);
        return;
      }

      if (e.target && e.target.id === 'block-btn') return blockCurrentUser();
      if (e.target && e.target.id === 'unblock-btn') return unblockCurrentUser();
      if (e.target && e.target.id === 'add-member-btn') return addMemberToGroup();
      if (e.target && e.target.id === 'leave-group-btn') return leaveGroup();

      var kickBtn = e.target.closest('.kick-btn');
      if (kickBtn) return kickMember(kickBtn.getAttribute('data-username'));

      var copyCurlBtn = e.target.closest('.copy-curl-btn');
      if (copyCurlBtn) {
        return copyText(copyCurlBtn.getAttribute('data-curl-kind') === 'watch' ? buildWatchCurl() : buildSendCurl(), copyCurlBtn);
      }

      var langItem = e.target.closest('.autocomplete-item');
      if (langItem) {
        qs('#compose-lang').value = langItem.getAttribute('data-lang');
        hide(qs('#lang-menu'));
        return;
      }

      if (!e.target.closest('.autocomplete')) hide(qs('#lang-menu'));
    });
  }

  function logout() {
    if (state.sidebarTimer) clearInterval(state.sidebarTimer);
    if (state.activeTimer) clearInterval(state.activeTimer);
    state.sidebarTimer = null;
    state.activeTimer = null;
    state.activeKind = null;
    state.activeId = null;
    state.activeData = null;
    state.dms = [];
    state.groups = [];
    state.unread = {};
    clearStoredSession();
    window.location.reload();
  }

  if (qs('#tex-stats')) renderLanding();

  if (qs('#app-shell')) {
    initTabs();
    initAuthForms();
    maybeBootFromStorage();
  }
})();
