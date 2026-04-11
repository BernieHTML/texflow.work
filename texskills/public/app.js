/* TexSkills shared frontend JS */
(function () {
  'use strict';

  const API = '/texskills/api';

  /* ── Utilities ── */
  function qs(sel, ctx)   { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx)  { return [...(ctx || document).querySelectorAll(sel)]; }
  function show(el)        { if (el) el.classList.remove('hidden'); }
  function hide(el)        { if (el) el.classList.add('hidden'); }
  function esc(s)          { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  }

  /* ── CountUp animation ── */
  function countUp(el, target, duration) {
    if (!el) return;
    const start = performance.now();
    const update = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(eased * target).toLocaleString();
      if (t < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  /* ── Copy buttons ── */
  function initCopyBtns() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      const block = btn.closest('.terminal');
      const pre   = block && block.querySelector('pre');
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent || pre.innerText).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      }).catch(() => {});
    });
  }

  /* ── Collapsible JSON blocks ── */
  function initCollapsibles() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.collapse-btn');
      if (!btn) return;
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const hidden = target.classList.toggle('hidden');
      btn.textContent = hidden ? 'show raw json' : 'hide raw json';
    });
  }

  /* ── Live stats bar (homepage) ── */
  function initStats() {
    const wrap = qs('#stats-bar');
    if (!wrap) return;
    function refresh() {
      fetch(`${API}/stats`)
        .then(r => r.json())
        .then(d => {
          const skillEl = qs('#stat-skills');
          const agentEl = qs('#stat-agents');
          const invEl   = qs('#stat-invocations');
          const todayEl = qs('#stat-today');
          if (skillEl) countUp(skillEl, d.skills || 0, 800);
          if (agentEl) countUp(agentEl, d.agents || 0, 800);
          if (invEl)   countUp(invEl,   d.total_invocations || 0, 1000);
          if (todayEl) countUp(todayEl, d.invocations_today || 0, 600);
        })
        .catch(() => {});
    }
    refresh();
    setInterval(refresh, 30000);
  }

  /* ── Recent skills (homepage) ── */
  function initRecent() {
    const grid = qs('#recent-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loader"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div><span>loading</span></div>';
    fetch(`${API}/recent`)
      .then(r => r.json())
      .then(d => {
        const skills = d.skills || [];
        if (!skills.length) {
          grid.innerHTML = '<div class="empty">No skills yet. Be the first to register one.</div>';
          return;
        }
        grid.innerHTML = '';
        skills.forEach((s, i) => {
          const a = document.createElement('a');
          a.className = 'skill-card';
          a.href = `/texskills/skills/${s.skill_id}`;
          a.style.animationDelay = `${i * 0.06}s`;
          const tags = (s.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('');
          a.innerHTML = `
            <div class="skill-card-name">${esc(s.name)}</div>
            <div class="skill-card-desc">${esc(s.description)}</div>
            <div class="tags">${tags}</div>
            <div class="skill-card-meta">
              <span class="skill-card-invoc">${fmtNum(s.stats?.invocations || 0)} runs</span>
              <span class="tag">${esc(s.version || '1.0')}</span>
            </div>`;
          grid.appendChild(a);
        });
      })
      .catch(() => {
        grid.innerHTML = '<div class="empty">Could not load recent skills.</div>';
      });
  }

  /* ── Catalog search (skills.html) ── */
  function initCatalog() {
    const wrap    = qs('#catalog-wrap');
    if (!wrap) return;
    const input   = qs('#search-input');
    const spinner = qs('#search-spinner');
    const tbody   = qs('#catalog-body');
    const count   = qs('#catalog-count');
    let timer;

    function load(q) {
      if (spinner) spinner.classList.add('show');
      const url = q ? `${API}/skills?q=${encodeURIComponent(q)}&limit=50` : `${API}/skills?limit=50`;
      // Pass a dummy key header so unauthenticated callers get a useful message.
      // For the UI, skills listing is done via the open recent endpoint for anon users.
      // We'll use /api/recent for the table too (public) then enrich.
      const endpoint = q ? `${API}/skills?q=${encodeURIComponent(q)}&limit=50` : `${API}/recent?limit=50`;
      fetch(q ? url : `${API}/recent`)
        .then(r => r.json())
        .then(d => {
          if (spinner) spinner.classList.remove('show');
          const skills = d.results || d.skills || [];
          if (count) count.textContent = `${skills.length} skill${skills.length !== 1 ? 's' : ''}`;
          renderTable(tbody, skills);
        })
        .catch(() => {
          if (spinner) spinner.classList.remove('show');
        });
    }

    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => load(input.value.trim()), 350);
      });
    }
    load('');
  }

  function renderTable(tbody, skills) {
    if (!tbody) return;
    if (!skills.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted);font-family:var(--font-mono);font-size:0.8rem;">No skills found.</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    skills.forEach((s, i) => {
      const tags = (s.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
      const inv  = fmtNum(s.stats?.invocations || 0);
      const sr   = s.stats?.success_rate != null ? `${s.stats.success_rate}%` : '—';
      const last = timeAgo(s.stats?.last_used);
      const tr   = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.style.opacity = '0';
      tr.style.animation = `fadeUp 0.25s ease ${i * 0.04}s forwards`;
      tr.innerHTML = `
        <td class="mono"><a href="/texskills/skills/${esc(s.skill_id)}" style="color:var(--accent-text)">${esc(s.name)}</a></td>
        <td class="muted">${esc((s.publisher || '').slice(0, 12))}…</td>
        <td>${tags}</td>
        <td class="accent">${inv}</td>
        <td class="muted">${sr}</td>
        <td class="muted">${last}</td>`;
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('a')) window.location.href = `/texskills/skills/${s.skill_id}`;
      });
      tbody.appendChild(tr);
    });
  }

  /* ── Skill detail page (skill.html) ── */
  function initSkillDetail() {
    const main = qs('#skill-main');
    if (!main) return;

    const pathParts  = window.location.pathname.split('/');
    const skillId    = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
    if (!skillId || skillId === 'skills') return;

    // Load skill (public endpoint via recent list isn't enough — we need the detail)
    // Since detail requires auth, we show what we can from public stats + catalog-style info.
    // In practice, visitors use the public /api/recent data; detail uses the same.
    fetch(`${API}/recent`)
      .then(r => r.json())
      .then(d => {
        const skill = (d.skills || []).find(s => s.skill_id === skillId);
        if (skill) {
          renderDetail(skill);
        } else {
          main.innerHTML = '<div class="empty" style="padding:4rem 0">Skill not found or no longer available.</div>';
        }
      })
      .catch(() => {
        main.innerHTML = '<div class="empty" style="padding:4rem 0">Failed to load skill.</div>';
      });

    // Load sparkline stats (public)
    loadSparkline(skillId);
  }

  function renderDetail(s) {
    const nameEl   = qs('#detail-name');
    const descEl   = qs('#detail-desc');
    const tagsEl   = qs('#detail-tags');
    const versionEl = qs('#detail-version');
    const publishEl = qs('#detail-publisher');

    if (nameEl)    nameEl.textContent  = s.name;
    if (descEl)    descEl.textContent  = s.description;
    if (versionEl) versionEl.textContent = `v${s.version || '1.0'}`;
    if (publishEl) publishEl.textContent = s.publisher || '—';
    document.title = `${s.name} — TexSkills`;

    if (tagsEl) {
      tagsEl.innerHTML = (s.tags || []).map(t => `<span class="tag tag-accent">${esc(t)}</span>`).join('');
    }

    // Stats panel
    const stats = s.stats || {};
    const set = (id, val) => { const el = qs(id); if (el) el.textContent = val; };
    set('#stat-invocations', fmtNum(stats.invocations));
    set('#stat-callers',     fmtNum(stats.unique_callers));
    set('#stat-latency',     stats.avg_latency_ms ? `${fmtNum(stats.avg_latency_ms)}ms` : '—');
    set('#stat-success',     stats.success_rate   ? `${stats.success_rate}%` : '—');
    set('#stat-last',        timeAgo(stats.last_used));

    // Input schema table
    if (s.input_schema && s.input_schema.properties) {
      renderSchemaTable(s.input_schema);
    }

    // JSON block
    const jsonEl = qs('#raw-json');
    if (jsonEl) {
      jsonEl.textContent = JSON.stringify({ ...s, endpoint: '[hidden]' }, null, 2);
    }

    // Curl example
    const curlEl = qs('#curl-pre');
    if (curlEl) {
      const schema = s.input_schema && s.input_schema.properties || {};
      const example = {};
      for (const [k, v] of Object.entries(schema)) {
        example[k] = v.example || (v.type === 'string' ? `<${k}>` : v.type === 'integer' ? 0 : `<${k}>`);
      }
      curlEl.innerHTML =
        `<span class="c"># Step 1 — register (once)</span>\n` +
        `<span class="k">curl</span> -sS -X POST <span class="u">"https://texflow.work/texskills/api/register"</span> \\\n` +
        `  -H <span class="s">"Content-Type: application/json"</span> \\\n` +
        `  -d <span class="s">'{"agent_name":"my-agent"}'</span>\n\n` +
        `<span class="c"># Step 2 — invoke ${esc(s.name)}</span>\n` +
        `<span class="k">curl</span> -sS -X POST <span class="u">"https://texflow.work/texskills/api/skills/${esc(s.skill_id)}/run"</span> \\\n` +
        `  -H <span class="s">"Content-Type: application/json"</span> \\\n` +
        `  -H <span class="s">"Authorization: Bearer tsk_YOUR_KEY"</span> \\\n` +
        `  -d <span class="s">'${esc(JSON.stringify(example))}'</span>`;
    }

    show(qs('#skill-main'));
    hide(qs('#skill-loading'));
  }

  function renderSchemaTable(schema) {
    const tbody = qs('#schema-tbody');
    if (!tbody) return;
    const required = schema.required || [];
    const props    = schema.properties || {};
    tbody.innerHTML = '';
    for (const [field, def] of Object.entries(props)) {
      const req = required.includes(field);
      tbody.innerHTML += `
        <tr>
          <td>${esc(field)}</td>
          <td><span class="type-pill">${esc(def.type || 'any')}</span></td>
          <td style="color:var(--muted)">${esc(def.description || '—')}</td>
          <td>${req ? '<span class="required-pill">required</span>' : '<span style="color:var(--dim);font-size:0.72rem">optional</span>'}</td>
        </tr>`;
    }
    show(qs('#schema-section'));
  }

  function loadSparkline(skillId) {
    fetch(`${API}/skills/${skillId}/stats`)
      .then(r => r.json())
      .then(d => {
        const daily = d.daily || [];
        drawSparkline(daily);
      })
      .catch(() => {});
  }

  function drawSparkline(daily) {
    const canvas = qs('#sparkline');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = daily.map(d => {
      const dt = new Date(d.date);
      return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    });
    const data = daily.map(d => d.count);
    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: 'rgba(0, 229, 200, 0.18)',
          borderColor:     'rgba(0, 229, 200, 0.7)',
          borderWidth:     1,
          borderRadius:    1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutQuart' },
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: '#17171c',
          titleColor: '#6a6a78',
          bodyColor: '#00e5c8',
          borderColor: '#2c2c38',
          borderWidth: 1,
          titleFont: { family: 'IBM Plex Mono', size: 10 },
          bodyFont:  { family: 'IBM Plex Mono', size: 12 },
        }},
        scales: {
          x: { grid: { color: '#1e1e26' }, ticks: { color: '#38383e', font: { family: 'IBM Plex Mono', size: 9 }, maxTicksLimit: 8 } },
          y: { grid: { color: '#1e1e26' }, ticks: { color: '#38383e', font: { family: 'IBM Plex Mono', size: 9 }, precision: 0 } },
        },
      },
    });
  }

  /* ── Docs page active nav ── */
  function initDocsNav() {
    const navItems = qsa('.docs-nav-item');
    if (!navItems.length) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          navItems.forEach(n => n.classList.remove('active'));
          const active = navItems.find(n => n.getAttribute('href') === '#' + e.target.id);
          if (active) active.classList.add('active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    qsa('.endpoint-section[id]').forEach(s => observer.observe(s));
  }

  /* ── Init ── */
  initCopyBtns();
  initCollapsibles();
  initStats();
  initRecent();
  initCatalog();
  initSkillDetail();
  initDocsNav();

})();
