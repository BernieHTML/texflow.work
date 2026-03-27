(function () {
  var header = document.querySelector('.header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
    header.classList.toggle('scrolled', window.scrollY > 40);
  }
})();

(function () {
  var wrap = document.querySelector('[data-nav-products]');
  if (!wrap) return;
  var btn = wrap.querySelector('.nav-products-btn');
  var panel = wrap.querySelector('.nav-products-panel');
  if (!btn || !panel) return;

  var isOpen = false;

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add('open');
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('open');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen) close(); else open();
  });

  document.addEventListener('click', function (e) {
    if (isOpen && !wrap.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) close();
  });
})();
