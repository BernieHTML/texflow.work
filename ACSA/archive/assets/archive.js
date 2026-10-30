(() => {
  'use strict';

  /* ---------- Starfield (ACSA brand) ---------- */
  const canvas = document.getElementById('stars');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const stars = [];
    const starCount = 180;
    const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };

    function resizeStars() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars.length = 0;
      for (let i = 0; i < starCount; i += 1) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          r: Math.random() * 1.4 + 0.25,
          base: Math.random() * 0.45 + 0.25,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.025 + 0.008,
          depth: Math.random() * 0.9 + 0.1
        });
      }
    }
    function drawStars() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parallax.x += (parallax.targetX - parallax.x) * 0.045;
      parallax.y += (parallax.targetY - parallax.y) * 0.045;
      const now = performance.now() * 0.035;
      for (const star of stars) {
        const opacity = star.base + Math.sin(now * star.speed + star.phase) * 0.25;
        const x = star.x + parallax.x * star.depth;
        const y = star.y + parallax.y * star.depth;
        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0.08, opacity)})`;
        ctx.fill();
      }
      requestAnimationFrame(drawStars);
    }
    window.addEventListener('resize', resizeStars);
    window.addEventListener('mousemove', (event) => {
      parallax.targetX = ((event.clientX / window.innerWidth) - 0.5) * 40;
      parallax.targetY = ((event.clientY / window.innerHeight) - 0.5) * 40;
    });
    resizeStars();
    drawStars();
  }

  /* ---------- Custom cursor ---------- */
  const cursorDot = document.querySelector('.cursor-dot');
  const cursorRing = document.querySelector('.cursor-ring');
  if (cursorDot && cursorRing && !window.matchMedia('(pointer: coarse)').matches) {
    const cursor = { x: innerWidth / 2, y: innerHeight / 2, ringX: innerWidth / 2, ringY: innerHeight / 2 };
    window.addEventListener('mousemove', (e) => {
      cursor.x = e.clientX; cursor.y = e.clientY;
      cursorDot.style.transform = `translate3d(${cursor.x - 2}px, ${cursor.y - 2}px, 0)`;
    });
    (function moveRing() {
      cursor.ringX += (cursor.x - cursor.ringX) * 0.34;
      cursor.ringY += (cursor.y - cursor.ringY) * 0.34;
      cursorRing.style.transform = `translate3d(${cursor.ringX - cursorRing.offsetWidth / 2}px, ${cursor.ringY - cursorRing.offsetHeight / 2}px, 0)`;
      requestAnimationFrame(moveRing);
    })();
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('a, button')) document.body.classList.add('cursor-hot');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('a, button')) document.body.classList.remove('cursor-hot');
    });
  }

  /* ---------- Theme toggle ---------- */
  const THEME_KEY = 'acsa-archive-theme';
  const themeBtn = document.getElementById('theme-toggle');
  function applyTheme(t) {
    document.body.classList.toggle('theme-light', t === 'light');
    if (themeBtn) themeBtn.textContent = t === 'light' ? 'Dark mode' : 'Light mode';
  }
  try { applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch (_) {}
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    });
  }

  /* ---------- Copy link ---------- */
  const copyBtn = document.getElementById('copy-link');
  const toast = document.getElementById('copy-toast');
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = copyBtn.dataset.url || window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard');
      } catch (_) {
        showToast(url);
      }
    });
  }

  /* ---------- PDF / print ---------- */
  const pdfBtn = document.getElementById('pdf-btn');
  if (pdfBtn && !pdfBtn.getAttribute('href')) {
    pdfBtn.addEventListener('click', (e) => { e.preventDefault(); window.print(); });
  }

  /* ---------- Reading progress + TOC scroll-spy ---------- */
  const progress = document.querySelector('.read-progress');
  const article = document.querySelector('.article');
  const tocLinks = Array.from(document.querySelectorAll('.toc a'));

  if (progress && article) {
    const onScroll = () => {
      const rect = article.getBoundingClientRect();
      const total = article.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      progress.style.width = `${Math.min(100, (scrolled / Math.max(total, 1)) * 100)}%`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (tocLinks.length) {
    const headings = tocLinks
      .map((l) => document.getElementById(l.getAttribute('href').slice(1)))
      .filter(Boolean);
    const spy = () => {
      let activeId = headings.length ? headings[0].id : null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 120) activeId = h.id;
      }
      tocLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${activeId}`));
    };
    window.addEventListener('scroll', spy, { passive: true });
    spy();
  }

  /* ---------- Landing search filter ---------- */
  const search = document.getElementById('archive-search-input');
  if (search) {
    const cards = Array.from(document.querySelectorAll('.paper-card'));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      cards.forEach((card) => {
        const hay = (card.dataset.search || '').toLowerCase();
        card.style.display = !q || hay.includes(q) ? '' : 'none';
      });
    });
  }
})();
