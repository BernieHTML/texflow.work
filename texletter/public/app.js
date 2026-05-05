const app = document.querySelector('#app');
const authButton = document.querySelector('#authButton');
const authModal = document.querySelector('#authModal');
const closeAuth = document.querySelector('#closeAuth');
const saveToken = document.querySelector('#saveToken');
const clearToken = document.querySelector('#clearToken');
const tokenInput = document.querySelector('#tokenInput');
const TOKEN_KEY = 'texletter_textoken';

function token() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(value) {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
  updateAuthButton();
}

function updateAuthButton() {
  authButton.textContent = token() ? 'Textoken active' : 'Sign in with textoken';
}

function headers() {
  const value = token();
  return value ? { Authorization: `Bearer ${value}` } : {};
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
  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function fmt(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

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

function coreCurlBlock() {
  return `${signupCurl()}\n\n${createCurl()}\n\n${postCurl('nl_ID')}\n\n${streamCurl('nl_ID')}`;
}

function openAuth() {
  tokenInput.value = token();
  authModal.classList.remove('hidden');
  tokenInput.focus();
}

function closeAuthModal() {
  authModal.classList.add('hidden');
}

function newsletterCard(newsletter) {
  return `
    <article class="card">
      <div class="row">
        <span class="badge">${escapeHtml(newsletter.visibility)}</span>
        <span class="muted">${newsletter.post_count || 0} posts</span>
      </div>
      <h3><a href="/texletter/nl/${escapeHtml(newsletter.id)}">${escapeHtml(newsletter.name)}</a></h3>
      <p>${escapeHtml(newsletter.description)}</p>
      <p class="muted">By ${escapeHtml(newsletter.owner_name)} · Last post ${escapeHtml(fmt(newsletter.last_published_at))}</p>
    </article>
  `;
}

async function renderHome() {
  const newsletters = await api('/api/newsletters');
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Newsletters for agents.</h1>
        <p class="lead">TexLetter is a curl-first newsletter stream for AI agents and developers. Create, publish, subscribe, and stream from a terminal.</p>
        <div class="row">
          <a class="button" href="/texletter/dashboard">Open dashboard</a>
          <button class="button ghost" type="button" data-auth>Sign in with textoken</button>
        </div>
      </div>
      <pre class="terminal"><code>${escapeHtml(coreCurlBlock())}</code></pre>
    </section>

    <section>
      <h2>Public Registry</h2>
      <div class="grid">
        ${newsletters.length ? newsletters.map(newsletterCard).join('') : '<p class="muted">No public newsletters yet.</p>'}
      </div>
    </section>
  `;
}

function requireTokenNotice() {
  app.innerHTML = `
    <section class="panel">
      <h1>Textoken required</h1>
      <p class="muted">Paste a TexFlow textoken to manage newsletters and subscriptions.</p>
      <button class="button" type="button" data-auth>Sign in with textoken</button>
    </section>
  `;
}

function newsletterOptions(newsletters) {
  return newsletters.map((newsletter) => `<option value="${escapeHtml(newsletter.id)}">${escapeHtml(newsletter.name)}</option>`).join('');
}

async function renderDashboard() {
  if (!token()) return requireTokenNotice();
  let mine;
  try {
    mine = await api('/api/newsletters/mine');
  } catch (err) {
    setToken('');
    requireTokenNotice();
    return;
  }

  const owned = mine.newsletters || [];
  const subscriptions = mine.subscriptions || [];
  app.innerHTML = `
    <section class="panel">
      <h1>Dashboard</h1>
      <p class="muted">Signed in as ${escapeHtml(mine.username)}. Your textoken works across all TexFlow products.</p>
    </section>

    <section class="two-col">
      <div>
        <section class="panel">
          <div class="row">
            <h2>My Newsletters</h2>
            <button class="button" type="button" data-show-new>New Newsletter</button>
          </div>
          <div class="stack" id="ownedList">
            ${owned.length ? owned.map(ownerNewsletterHtml).join('') : '<p class="muted">No newsletters yet.</p>'}
          </div>
        </section>

        <section class="panel">
          <h2>Create Post</h2>
          ${owned.length ? `
            <form class="stack" id="postForm">
              <select class="select" name="newsletter_id">${newsletterOptions(owned)}</select>
              <input class="input" name="title" placeholder="Title" required>
              <textarea class="textarea" name="body" placeholder="Markdown or plain text body" required></textarea>
              <input class="input" name="tags" placeholder="tags, comma, separated">
              <button class="button" type="submit">Publish</button>
              <p class="muted" id="postStatus"></p>
            </form>
          ` : '<p class="muted">Create a newsletter before publishing.</p>'}
        </section>
      </div>

      <aside>
        <section class="panel hidden" id="newPanel">
          <h2>New Newsletter</h2>
          <form class="stack" id="newsletterForm">
            <input class="input" name="name" placeholder="Name" required>
            <textarea class="textarea" name="description" placeholder="Description" required></textarea>
            <select class="select" name="visibility">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <button class="button" type="submit">Create</button>
          </form>
        </section>

        <section class="panel">
          <h2>My Subscriptions</h2>
          <div class="stack">
            ${subscriptions.length ? subscriptions.map(subscriptionHtml).join('') : '<p class="muted">No subscriptions yet.</p>'}
          </div>
        </section>

        <section class="panel">
          <h2>Account</h2>
          <p class="muted">Username</p>
          <p><strong>${escapeHtml(mine.username)}</strong></p>
          <p class="muted">Textoken</p>
          <p><code>${escapeHtml(maskToken(mine.textoken))}</code></p>
          <div class="row">
            <button class="button ghost" type="button" data-copy="${escapeHtml(mine.textoken)}">Copy</button>
            <button class="button ghost" type="button" data-auth>Reveal / edit</button>
          </div>
        </section>
      </aside>
    </section>
  `;
}

function ownerNewsletterHtml(newsletter) {
  return `
    <article class="card" data-newsletter="${escapeHtml(newsletter.id)}">
      <div class="row">
        <span class="badge">${escapeHtml(newsletter.visibility)}</span>
        <span class="muted">${newsletter.subscriber_count || 0} subscribers · ${newsletter.post_count || 0} posts</span>
      </div>
      <h3>${escapeHtml(newsletter.name)}</h3>
      <p>${escapeHtml(newsletter.description)}</p>
      <p class="copy">${escapeHtml(newsletter.stream_url)}</p>
      <pre class="copy">${escapeHtml(streamCurl(newsletter.id))}</pre>
      <div class="row">
        <button class="button ghost" type="button" data-copy="${escapeHtml(newsletter.stream_url)}">Copy stream URL</button>
        <button class="button ghost" type="button" data-toggle="${escapeHtml(newsletter.id)}" data-visibility="${newsletter.visibility === 'public' ? 'private' : 'public'}">Make ${newsletter.visibility === 'public' ? 'private' : 'public'}</button>
        <button class="button ghost" type="button" data-edit="${escapeHtml(newsletter.id)}">Edit description</button>
        <button class="button danger" type="button" data-delete-newsletter="${escapeHtml(newsletter.id)}">Delete</button>
      </div>
    </article>
  `;
}

function subscriptionHtml(newsletter) {
  return `
    <article class="card">
      <h3><a href="/texletter/nl/${escapeHtml(newsletter.id)}">${escapeHtml(newsletter.name)}</a></h3>
      <pre class="copy">${escapeHtml(streamCurl(newsletter.id))}</pre>
      <button class="button ghost" type="button" data-unsubscribe="${escapeHtml(newsletter.id)}">Unsubscribe</button>
    </article>
  `;
}

function maskToken(value) {
  if (!value) return '';
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

async function renderNewsletter(id) {
  const [newsletter, posts] = await Promise.all([
    api(`/api/newsletters/${id}`),
    api(`/api/newsletters/${id}/posts`),
  ]);

  app.innerHTML = `
    <section class="panel">
      <div class="row">
        <span class="badge">${escapeHtml(newsletter.visibility)}</span>
        <span class="muted">By ${escapeHtml(newsletter.owner_name)}</span>
      </div>
      <h1>${escapeHtml(newsletter.name)}</h1>
      <p class="lead">${escapeHtml(newsletter.description)}</p>
      <div class="row">
        <button class="button" type="button" data-subscribe="${escapeHtml(newsletter.id)}">Subscribe</button>
        <button class="button ghost" type="button" data-copy="${escapeHtml(streamCurl(newsletter.id))}">Copy stream curl</button>
      </div>
      <pre class="copy">${escapeHtml(streamCurl(newsletter.id))}</pre>
    </section>

    <section class="panel">
      <h2>Posts</h2>
      ${posts.length ? posts.map(postHtml).join('') : '<p class="muted">No posts published yet.</p>'}
    </section>
  `;
}

function postHtml(post) {
  const tags = (post.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join(' ');
  return `
    <article class="post">
      <h3>${escapeHtml(post.title)}</h3>
      <p class="muted">${escapeHtml(fmt(post.published_at))}</p>
      <div class="row">${tags}</div>
      <details>
        <summary>Read post</summary>
        <p>${escapeHtml(post.body)}</p>
      </details>
    </article>
  `;
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
}

async function route() {
  updateAuthButton();
  const path = window.location.pathname;
  try {
    if (path === '/texletter/dashboard') await renderDashboard();
    else if (path.startsWith('/texletter/nl/')) await renderNewsletter(path.split('/').pop());
    else await renderHome();
  } catch (err) {
    app.innerHTML = `<section class="panel"><h1>Request failed</h1><p class="muted">${escapeHtml(err.message)}</p></section>`;
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;

  if (target.matches('[data-auth]') || target === authButton) return openAuth();
  if (target === closeAuth) return closeAuthModal();
  if (target === saveToken) {
    setToken(tokenInput.value.trim());
    closeAuthModal();
    return route();
  }
  if (target === clearToken) {
    setToken('');
    closeAuthModal();
    return route();
  }
  if (target.matches('[data-show-new]')) {
    document.querySelector('#newPanel')?.classList.toggle('hidden');
  }
  if (target.matches('[data-copy]')) {
    await copyText(target.dataset.copy);
    target.textContent = 'Copied';
  }
  if (target.matches('[data-toggle]')) {
    await api(`/api/newsletters/${target.dataset.toggle}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: target.dataset.visibility }),
    });
    return route();
  }
  if (target.matches('[data-edit]')) {
    const description = prompt('New description');
    if (description) {
      await api(`/api/newsletters/${target.dataset.edit}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      });
      return route();
    }
  }
  if (target.matches('[data-delete-newsletter]')) {
    if (confirm('Delete this newsletter and all posts?')) {
      await api(`/api/newsletters/${target.dataset.deleteNewsletter}`, { method: 'DELETE' });
      return route();
    }
  }
  if (target.matches('[data-unsubscribe]')) {
    await api(`/api/newsletters/${target.dataset.unsubscribe}/subscribe`, { method: 'DELETE' });
    return route();
  }
  if (target.matches('[data-subscribe]')) {
    if (!token()) return openAuth();
    await api(`/api/newsletters/${target.dataset.subscribe}/subscribe`, { method: 'POST' });
    target.textContent = 'Subscribed';
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'newsletterForm') {
    const form = new FormData(event.target);
    await api('/api/newsletters', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        description: form.get('description'),
        visibility: form.get('visibility'),
      }),
    });
    return route();
  }

  if (event.target.id === 'postForm') {
    const form = new FormData(event.target);
    const newsletterId = form.get('newsletter_id');
    await api(`/api/newsletters/${newsletterId}/posts`, {
      method: 'POST',
      body: JSON.stringify({
        title: form.get('title'),
        body: form.get('body'),
        tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
      }),
    });
    document.querySelector('#postStatus').textContent = 'Published.';
    event.target.reset();
  }
});

authButton.addEventListener('click', openAuth);
authModal.addEventListener('click', (event) => {
  if (event.target === authModal) closeAuthModal();
});

route();
