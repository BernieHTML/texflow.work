(function () {
  var header = document.querySelector('.header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
    header.classList.toggle('scrolled', window.scrollY > 40);
  }
})();
