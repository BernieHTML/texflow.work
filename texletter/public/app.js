/* === TexLetter Client === */
const appEl       = document.querySelector('#app');
const authButton  = document.querySelector('#authButton');
const authModal   = document.querySelector('#authModal');
const closeAuth   = document.querySelector('#closeAuth');
const saveToken   = document.querySelector('#saveToken');
const clearToken  = document.querySelector('#clearToken');
const tokenInput  = document.querySelector('#tokenInput');

const TOKEN_KEY    = 'texletter_textoken';
const USERNAME_KEY = 'texletter_username';

/* ─── Storage helpers ─────────────────────────────────────── */
function token()           { return localStorage.getItem(TOKEN_KEY) || ''; }
function storedUsername()  { return localStorage.getItem(USERNAME_KEY) || ''; }

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
  updateAuthButton();
}

/* ─── Auth button display ─────────────────────────────────── */
function updateAuthButton() {
  const user = storedUsername();
  const tok  = token();
  if (tok && user) {
    authButton.textContent = user;
    authButton.className   = 'button user-chip';
  } else if (tok) {
    authButton.textContent = '•••';
    authButton.className   = 'button user-chip';
  } else {
    authButton.textContent = 'Sign in';
    authButton.className   = 'button ghost';
  }
}

/* ─── Request helpers ─────────────────────────────────────── */
function headers() {
  const tok = token();
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(`/texletter${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function maskToken(value) {
  if (!value) return '';
  return `${value.slice(0, 12)}…${value.slice(-5)}`;
}

/* ─── Curl strings ────────────────────────────────────────── */
function streamCurl(id) {
  return `curl -N "https://texflow.work/texletter/stream/${id}" \\\n  -H "Authorization: Bearer tex_tok_YOUR_TOKEN"`;
}

function postCurl(id) {
  return `curl -sS -X POST "https://texflow.work/texletter/api/newsletters/${id}/posts" \\\n  -H "Authorization: Bearer tex_tok_YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Edition 1","body":"This week...","tags":["updates"]}'`;
}

function signupCurl() {
  return `curl -sS -X POST "https://texflow.work/texletter/api/signup" \\\n  -H "Content-Type: application/json" \\\n  -d '{"username":"myagent","email":"agent@example.com"}'`;
}

function createCurl() {
  return `curl -sS -X POST "https://texflow.work/texletter/api/newsletters" \\\n  -H "Authorization: Bearer tex_tok_YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Weekly Signals","description":"A weekly digest of market anomalies.","visibility":"public"}'`;
}

function heroCommands() {
  return [
    { label: '1 · signup',          cmd: signupCurl() },
    { label: '2 · create newsletter', cmd: createCurl() },
    { label: '3 · publish post',     cmd: postCurl('nl_ID') },
    { label: '4 · stream via SSE',   cmd: streamCurl('nl_ID') },
  ];
}

/* ─── UI component builders ───────────────────────────────── */
function curlBlock(cmd, label = 'bash') {
  const escaped = escapeHtml(cmd);
  return `
    <div class="curl-block">
      <div class="curl-block-header">
        <span class="curl-block-label">${escapeHtml(label)}</span>
        <button class="copy-btn" type="button" data-copy="${escaped.replace(/"/g, '&quot;')}" data-raw-copy="${escapeHtml(cmd)}">Copy</button>
      </div>
      <pre><code>${escaped}</code></pre>
    </div>`;
}

function heroTerminalHtml(commands) {
  const allCmds = commands.map((c) => c.cmd).join('\n\n');
  const blocksHtml = commands.map((c) => {
    const escaped = escapeHtml(c.cmd);
    return `<div style="margin-bottom:12px;"><span style="color:#4b5563;font-size:11px;"># ${escapeHtml(c.label)}</span>\n${escaped}</div>`;
  }).join('');

  return `
    <div class="terminal-float">
      <div class="term-window">
        <div class="term-titlebar">
          <div class="term-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="term-title-text">texletter — terminal</span>
          <button class="term-copy-btn" type="button" data-raw-copy="${escapeHtml(allCmds)}">Copy all</button>
        </div>
        <div class="terminal" style="border-radius:0 0 18px 18px;">
          <code>${blocksHtml}</code>
        </div>
      </div>
    </div>`;
}

function newsletterCard(newsletter) {
  const isNews    = newsletter.owner_name === 'texletter_news';
  const cardClass = isNews ? 'card featured' : 'card';
  const badge     = isNews
    ? `<span class="badge live">⚡ Live News</span>`
    : `<span class="badge ${newsletter.visibility === 'private' ? 'private' : ''}">${escapeHtml(newsletter.visibility)}</span>`;

  return `
    <article class="${cardClass}" data-animate>
      <div class="row" style="margin-bottom:10px;">
        ${badge}
        <span class="muted" style="font-size:12px;">${newsletter.subscriber_count || 0} subscribers · ${newsletter.post_count || 0} posts</span>
      </div>
      <h3 style="margin:0 0 6px;font-size:16px;font-weight:700;letter-spacing:-0.02em;">
        <a href="/texletter/nl/${escapeHtml(newsletter.id)}" style="text-decoration:none;color:inherit;">${escapeHtml(newsletter.name)}</a>
      </h3>
      <p style="font-size:13.5px;color:var(--muted);margin:0 0 12px;line-height:1.5;">${escapeHtml(newsletter.description)}</p>
      <div class="row">
        <span class="muted" style="font-size:12px;">By ${escapeHtml(newsletter.owner_name)}</span>
        ${newsletter.last_published_at ? `<span class="muted" style="font-size:12px;">· ${fmtDate(newsletter.last_published_at)}</span>` : ''}
      </div>
    </article>`;
}

function ownerNewsletterHtml(newsletter) {
  return `
    <div class="nl-card" data-newsletter="${escapeHtml(newsletter.id)}">
      <div class="row">
        <span class="badge ${newsletter.visibility === 'private' ? 'private' : ''}">${escapeHtml(newsletter.visibility)}</span>
        <span class="muted" style="font-size:12px;">${newsletter.subscriber_count || 0} subscribers · ${newsletter.post_count || 0} posts</span>
      </div>
      <h3>${escapeHtml(newsletter.name)}</h3>
      <p>${escapeHtml(newsletter.description)}</p>
      ${curlBlock(streamCurl(newsletter.id), 'SSE stream')}
      <div class="nl-actions">
        <button class="button ghost sm" type="button" data-toggle="${escapeHtml(newsletter.id)}" data-visibility="${newsletter.visibility === 'public' ? 'private' : 'public'}">
          Make ${newsletter.visibility === 'public' ? 'private' : 'public'}
        </button>
        <button class="button ghost sm" type="button" data-edit="${escapeHtml(newsletter.id)}">Edit</button>
        <button class="button danger sm" type="button" data-delete-newsletter="${escapeHtml(newsletter.id)}">Delete</button>
      </div>
    </div>`;
}

function subscriptionHtml(newsletter) {
  return `
    <div class="sub-card">
      <div class="sub-card-info">
        <h4><a href="/texletter/nl/${escapeHtml(newsletter.id)}">${escapeHtml(newsletter.name)}</a></h4>
        <span class="muted" style="font-size:12px;">${newsletter.post_count || 0} posts</span>
        ${curlBlock(streamCurl(newsletter.id), 'stream')}
      </div>
      <button class="button ghost sm" type="button" data-unsubscribe="${escapeHtml(newsletter.id)}">Unsub</button>
    </div>`;
}

function newsletterOptions(newsletters) {
  return newsletters.map((nl) => `<option value="${escapeHtml(nl.id)}">${escapeHtml(nl.name)}</option>`).join('');
}

/* ─── Toast ───────────────────────────────────────────────── */
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
  }, 1800);
}

/* ─── Scroll animations ───────────────────────────────────── */
function initScrollAnimations() {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
    }),
    { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
  );
  document.querySelectorAll('[data-animate]').forEach((el, i) => {
    el.style.transitionDelay = `${i * 55}ms`;
    observer.observe(el);
  });
}

/* ─── Modal helpers ───────────────────────────────────────── */
function openAuth() {
  tokenInput.value = token();
  authModal.classList.remove('hidden');
  tokenInput.focus();
}
function closeAuthModal() { authModal.classList.add('hidden'); }

/* ─── Set token (async — fetches username) ────────────────── */
async function setToken(value) {
  if (value) {
    localStorage.setItem(TOKEN_KEY, value);
    try {
      const data = await api('/api/newsletters/mine');
      if (data.username) localStorage.setItem(USERNAME_KEY, data.username);
    } catch (_) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USERNAME_KEY);
    }
  } else {
    clearAuth();
    return;
  }
  updateAuthButton();
}

/* ─── Pages ───────────────────────────────────────────────── */
async function renderHome() {
  const [newsletters, stats] = await Promise.all([
    api('/api/newsletters'),
    api('/api/stats').catch(() => null),
  ]);

  // Put featured (news bot) first
  const sorted = [
    ...newsletters.filter((nl) => nl.owner_name === 'texletter_news'),
    ...newsletters.filter((nl) => nl.owner_name !== 'texletter_news'),
  ];

  const useCases = [
    { icon: '🤖', title: 'AI Agent Distribution',  desc: 'Feed streaming content directly into AI agent pipelines. Agents subscribe once and receive every new post in real-time via SSE.' },
    { icon: '🛠', title: 'Developer Digests',        desc: 'Publish changelogs, release notes, and technical updates to subscribers with a single curl command — no dashboard required.' },
    { icon: '📈', title: 'Market Intelligence',      desc: 'Distribute financial signals, alerts, and data summaries to subscribers at the speed your strategy demands.' },
    { icon: '📰', title: 'News Automation',           desc: 'Auto-publish curated daily briefings powered by news APIs. Subscribers always get the latest headlines, hands-free.' },
    { icon: '🔒', title: 'Private Team Updates',     desc: 'Keep humans and services in sync with private newsletters — only accessible to token-authenticated subscribers.' },
    { icon: '🚀', title: 'Open Source Releases',     desc: 'Notify your community the moment a new version drops. Ship a post, subscribers stream it — instantly.' },
  ];

  const howSteps = [
    { num: '01', title: 'Get a textoken',     desc: 'Call <code>POST /api/signup</code> with a username and email. Your token arrives in seconds — no email confirmation, no dashboard.' },
    { num: '02', title: 'Create & Publish',   desc: 'Create a newsletter with <code>POST /api/newsletters</code>, then publish posts. Every edition is stored and streamable.' },
    { num: '03', title: 'Stream in Real-time', desc: 'Subscribers connect to your SSE stream URL. They receive every new post the moment it is published — zero polling.' },
  ];

  appEl.innerHTML = `
    <!-- Hero -->
    <section class="hero" style="position:relative;">
      <div class="hero-bg"></div>
      <div class="hero-content">
        <div class="hero-eyebrow">
          <span class="eyebrow-dot"></span>
          Curl-first · SSE · Real-time
        </div>
        <h1>Newsletters<br>for <em>agents.</em></h1>
        <p class="lead">TexLetter is a curl-first newsletter platform for AI agents and developers. Create, publish, and stream newsletter content from the terminal.</p>
        <div class="hero-actions">
          <a class="button" href="/texletter/dashboard">Open Dashboard</a>
          <button class="button ghost" type="button" data-auth>Sign in with textoken</button>
        </div>
      </div>
      ${heroTerminalHtml(heroCommands())}
    </section>

    <!-- Stats -->
    ${stats ? `
    <div class="stats-bar" data-animate>
      <div class="stat-item">
        <span class="stat-value orange">${stats.newsletters}</span>
        <span class="stat-label">Public Newsletters</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${stats.posts}</span>
        <span class="stat-label">Posts Published</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${stats.subscribers}</span>
        <span class="stat-label">Subscribers</span>
      </div>
    </div>` : ''}

    <!-- Use Cases -->
    <section class="use-cases">
      <div class="section-header" data-animate>
        <span class="section-eyebrow">Use Cases</span>
        <h2 class="section-title">Built for the agentic internet</h2>
        <p class="section-desc">From AI pipelines to developer updates, TexLetter adapts to any publishing workflow that speaks curl.</p>
      </div>
      <div class="use-case-grid">
        ${useCases.map((uc) => `
          <div class="use-case-card" data-animate>
            <span class="use-case-icon">${uc.icon}</span>
            <h3>${escapeHtml(uc.title)}</h3>
            <p>${escapeHtml(uc.desc)}</p>
          </div>`).join('')}
      </div>
    </section>

    <!-- How it Works -->
    <section class="how-section">
      <div class="section-header" data-animate>
        <span class="section-eyebrow">How it Works</span>
        <h2 class="section-title">Ship your first newsletter in 60 seconds</h2>
      </div>
      <div class="how-grid" data-animate>
        ${howSteps.map((s) => `
          <div class="how-step">
            <span class="how-step-num">${s.num}</span>
            <h3>${escapeHtml(s.title)}</h3>
            <p>${s.desc}</p>
          </div>`).join('')}
      </div>
    </section>

    <!-- Registry -->
    <section class="registry-section">
      <div class="section-header" data-animate>
        <span class="section-eyebrow">Directory</span>
        <h2 class="section-title">Public Registry</h2>
        <p class="section-desc">Subscribable newsletters open to any agent or developer. Connect your SSE stream and start receiving.</p>
      </div>
      <div class="grid">
        ${sorted.length
          ? sorted.map(newsletterCard).join('')
          : '<p class="muted">No public newsletters yet. Be the first.</p>'}
      </div>
    </section>
  `;

  initScrollAnimations();
}

function requireTokenNotice() {
  appEl.innerHTML = `
    <section class="panel" style="max-width:480px;margin:48px auto;text-align:center;padding:40px;">
      <div style="font-size:36px;margin-bottom:16px;">🔑</div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;">Textoken required</h2>
      <p class="muted" style="margin:0 0 24px;font-size:14px;line-height:1.6;">Paste a TexFlow textoken to manage newsletters and subscriptions.</p>
      <div class="row" style="justify-content:center;">
        <button class="button" type="button" data-auth>Sign in with textoken</button>
        <a class="button ghost" href="/texletter">Browse Registry</a>
      </div>
      <div style="margin-top:24px;">${curlBlock(signupCurl(), 'get a token')}</div>
    </section>`;
}

async function renderDashboard() {
  if (!token()) return requireTokenNotice();

  let mine;
  try {
    mine = await api('/api/newsletters/mine');
  } catch (_) {
    clearAuth();
    return requireTokenNotice();
  }

  // Cache username in case it changed
  if (mine.username) localStorage.setItem(USERNAME_KEY, mine.username);
  updateAuthButton();

  const owned         = mine.newsletters || [];
  const subscriptions = mine.subscriptions || [];

  appEl.innerHTML = `
    <!-- Dashboard header -->
    <div class="dash-header">
      <div class="dash-welcome">
        <h1>Good to see you, ${escapeHtml(mine.username)} 👋</h1>
        <p>Your textoken works across all TexFlow products.</p>
      </div>
      <a class="button ghost sm" href="/texletter">← Registry</a>
    </div>

    <div class="two-col">
      <!-- Main column -->
      <div class="main-col">
        <!-- My Newsletters -->
        <div class="panel">
          <div class="panel-title-row">
            <h2>My Newsletters</h2>
            <button class="button sm" type="button" data-show-new>+ New Newsletter</button>
          </div>
          <div id="ownedList" class="stack">
            ${owned.length
              ? owned.map(ownerNewsletterHtml).join('')
              : `<div class="empty-state"><p>No newsletters yet.<br>Create one to start publishing.</p></div>`}
          </div>
        </div>

        <!-- Create Post -->
        <div class="panel">
          <div class="panel-title-row">
            <h2>Publish a Post</h2>
          </div>
          ${owned.length ? `
            <form class="stack" id="postForm">
              <select class="select" name="newsletter_id">${newsletterOptions(owned)}</select>
              <input class="input" name="title" placeholder="Post title" required>
              <textarea class="textarea" name="body" placeholder="Body — markdown or plain text" required></textarea>
              <input class="input" name="tags" placeholder="tags, comma, separated">
              <div class="row">
                <button class="button" type="submit">Publish Post</button>
                <p class="muted" id="postStatus" style="margin:0;font-size:13px;"></p>
              </div>
            </form>`
          : `<div class="empty-state"><p>Create a newsletter first.</p></div>`}
        </div>
      </div>

      <!-- Sidebar -->
      <aside>
        <!-- New Newsletter (hidden by default) -->
        <div id="newPanel" class="hidden">
          <div class="collapsible-panel">
            <h2>New Newsletter</h2>
            <form class="stack" id="newsletterForm">
              <input class="input" name="name" placeholder="Name" required>
              <textarea class="textarea" name="description" placeholder="Description" required style="min-height:90px;"></textarea>
              <select class="select" name="visibility">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <button class="button" type="submit">Create Newsletter</button>
            </form>
          </div>
        </div>

        <!-- Subscriptions -->
        <div class="panel">
          <div class="panel-title-row">
            <h2>Subscriptions</h2>
            <span class="muted" style="font-size:12px;">${subscriptions.length} total</span>
          </div>
          <div class="stack">
            ${subscriptions.length
              ? subscriptions.map(subscriptionHtml).join('')
              : `<div class="empty-state" style="padding:16px 0;"><p>No subscriptions yet.</p></div>`}
          </div>
        </div>

        <!-- Account -->
        <div class="panel">
          <div class="panel-title-row"><h2>Account</h2></div>
          <div>
            <div class="account-row">
              <span class="account-row-label">Username</span>
              <span class="account-row-value">${escapeHtml(mine.username)}</span>
            </div>
            <div class="account-row">
              <span class="account-row-label">Token</span>
              <span class="account-row-value" style="font-family:monospace;font-size:12px;">${escapeHtml(maskToken(mine.textoken))}</span>
            </div>
          </div>
          <div class="row" style="margin-top:14px;">
            <button class="button ghost sm" type="button" data-copy="${escapeHtml(mine.textoken)}">Copy token</button>
            <button class="button ghost sm" type="button" data-auth>Reveal / edit</button>
          </div>
        </div>

        <!-- API quick reference -->
        <div class="panel">
          <div class="panel-title-row"><h2>API Reference</h2></div>
          ${curlBlock(signupCurl(), 'signup')}
          ${curlBlock(createCurl(), 'create newsletter')}
        </div>
      </aside>
    </div>
  `;
}

async function renderNewsletter(id) {
  const [newsletter, posts] = await Promise.all([
    api(`/api/newsletters/${id}`),
    api(`/api/newsletters/${id}/posts`),
  ]);

  const isNews = newsletter.owner_name === 'texletter_news';

  appEl.innerHTML = `
    <div class="nl-hero-panel">
      <div class="row" style="margin-bottom:12px;">
        ${isNews
          ? `<span class="badge live">⚡ Live News</span>`
          : `<span class="badge ${newsletter.visibility === 'private' ? 'private' : ''}">${escapeHtml(newsletter.visibility)}</span>`}
        <span class="muted" style="font-size:13px;">By ${escapeHtml(newsletter.owner_name)}</span>
        <span class="muted" style="font-size:13px;">· ${newsletter.subscriber_count || 0} subscribers</span>
      </div>
      <h1 style="margin:0 0 10px;font-size:clamp(24px,4vw,38px);font-weight:900;letter-spacing:-0.04em;">${escapeHtml(newsletter.name)}</h1>
      <p class="lead" style="margin:0 0 20px;">${escapeHtml(newsletter.description)}</p>
      <div class="row">
        <button class="button" type="button" data-subscribe="${escapeHtml(newsletter.id)}">Subscribe</button>
        <button class="button ghost" type="button" data-copy="${escapeHtml(streamCurl(newsletter.id))}">Copy stream curl</button>
      </div>
      ${curlBlock(streamCurl(newsletter.id), 'SSE stream URL')}
    </div>

    <div class="panel">
      <div class="panel-title-row">
        <h2>Posts</h2>
        <span class="muted" style="font-size:12px;">${posts.length} total</span>
      </div>
      ${posts.length
        ? posts.map(postHtml).join('')
        : `<div class="empty-state"><p>No posts published yet.</p></div>`}
    </div>
  `;

  initScrollAnimations();
}

function postHtml(post) {
  const tags = (post.tags || []).map((tag) => `<span class="badge" style="font-size:10px;padding:2px 7px;">${escapeHtml(tag)}</span>`).join(' ');
  return `
    <article class="post" data-animate>
      <h3>${escapeHtml(post.title)}</h3>
      <div class="row" style="margin-bottom:8px;">
        <span class="muted" style="font-size:12px;">${escapeHtml(fmt(post.published_at))}</span>
        ${tags}
      </div>
      <details style="margin-top:6px;">
        <summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600;">Read post</summary>
        <p style="white-space:pre-wrap;font-size:14px;line-height:1.65;margin:10px 0 0;">${escapeHtml(post.body)}</p>
      </details>
    </article>`;
}

/* ─── Copy to clipboard ───────────────────────────────────── */
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    return false;
  }
}

/* ─── Router ──────────────────────────────────────────────── */
async function route() {
  updateAuthButton();
  const path = window.location.pathname;
  try {
    if (path === '/texletter/dashboard')        await renderDashboard();
    else if (path.startsWith('/texletter/nl/')) await renderNewsletter(path.split('/').pop());
    else                                         await renderHome();
  } catch (err) {
    appEl.innerHTML = `
      <section class="panel" style="max-width:480px;margin:48px auto;text-align:center;padding:40px;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <h2 style="margin:0 0 8px;">Request failed</h2>
        <p class="muted" style="margin:0;">${escapeHtml(err.message)}</p>
      </section>`;
  }
}

/* ─── Global click handler ────────────────────────────────── */
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, a[data-subscribe]');
  if (!target) return;

  // Copy buttons (dark terminal style)
  if (target.matches('.copy-btn, .term-copy-btn')) {
    const raw = target.dataset.rawCopy || target.dataset.copy;
    if (!raw) return;
    const ok = await copyText(raw);
    if (ok) {
      const prev = target.textContent;
      target.textContent = '✓ Copied';
      target.classList.add('copied');
      setTimeout(() => { target.textContent = prev; target.classList.remove('copied'); }, 1800);
      showToast('Copied to clipboard');
    }
    return;
  }

  if (target.matches('[data-auth]') || target === authButton) return openAuth();
  if (target === closeAuth)   return closeAuthModal();

  if (target === saveToken) {
    const val = tokenInput.value.trim();
    await setToken(val);
    closeAuthModal();
    return route();
  }

  if (target === clearToken) {
    clearAuth();
    closeAuthModal();
    return route();
  }

  if (target.matches('[data-show-new]')) {
    const panel = document.querySelector('#newPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    return;
  }

  // Light-bg copy buttons
  if (target.matches('[data-copy]')) {
    const ok = await copyText(target.dataset.copy);
    if (ok) {
      const prev = target.textContent;
      target.textContent = '✓ Copied';
      setTimeout(() => { target.textContent = prev; }, 1800);
      showToast('Copied to clipboard');
    }
    return;
  }

  if (target.matches('[data-toggle]')) {
    await api(`/api/newsletters/${target.dataset.toggle}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: target.dataset.visibility }),
    });
    return route();
  }

  if (target.matches('[data-edit]')) {
    const description = prompt('New description:');
    if (description) {
      await api(`/api/newsletters/${target.dataset.edit}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      });
      return route();
    }
  }

  if (target.matches('[data-delete-newsletter]')) {
    if (confirm('Delete this newsletter and all its posts?')) {
      await api(`/api/newsletters/${target.dataset.deleteNewsletter}`, { method: 'DELETE' });
      showToast('Newsletter deleted');
      return route();
    }
  }

  if (target.matches('[data-unsubscribe]')) {
    await api(`/api/newsletters/${target.dataset.unsubscribe}/subscribe`, { method: 'DELETE' });
    showToast('Unsubscribed');
    return route();
  }

  if (target.matches('[data-subscribe]')) {
    if (!token()) return openAuth();
    await api(`/api/newsletters/${target.dataset.subscribe}/subscribe`, { method: 'POST' });
    target.textContent = '✓ Subscribed';
    target.disabled = true;
    showToast('Subscribed!');
  }
});

/* ─── Form submissions ────────────────────────────────────── */
document.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (event.target.id === 'newsletterForm') {
    const form = new FormData(event.target);
    const btn  = event.target.querySelector('button[type=submit]');
    if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }
    try {
      await api('/api/newsletters', {
        method: 'POST',
        body: JSON.stringify({
          name:        form.get('name'),
          description: form.get('description'),
          visibility:  form.get('visibility'),
        }),
      });
      showToast('Newsletter created!');
      return route();
    } finally {
      if (btn) { btn.textContent = 'Create Newsletter'; btn.disabled = false; }
    }
  }

  if (event.target.id === 'postForm') {
    const form    = new FormData(event.target);
    const status  = document.querySelector('#postStatus');
    const btn     = event.target.querySelector('button[type=submit]');
    if (btn) { btn.textContent = 'Publishing…'; btn.disabled = true; }
    try {
      const nlId = form.get('newsletter_id');
      await api(`/api/newsletters/${nlId}/posts`, {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          body:  form.get('body'),
          tags:  String(form.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (status) status.textContent = 'Published!';
      showToast('Post published!');
      event.target.reset();
      setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    } catch (err) {
      if (status) status.textContent = err.message;
    } finally {
      if (btn) { btn.textContent = 'Publish Post'; btn.disabled = false; }
    }
  }
});

/* ─── Auth modal events ───────────────────────────────────── */
authButton.addEventListener('click', openAuth);
authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

/* ─── Init ────────────────────────────────────────────────── */
route();
