(function () {
  var btn = document.querySelector('.nav-hamburger');
  var menu = document.querySelector('.nav-mobile');
  if (!btn || !menu) return;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var isOpen = menu.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', function (e) {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      menu.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
})();
