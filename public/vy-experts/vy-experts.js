(function () {
  'use strict';

  window.vyCopy = function (text, buttonEl) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      fallbackCopy(text);
      showCopyFeedback(buttonEl);
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      showCopyFeedback(buttonEl);
    }).catch(function () {
      fallbackCopy(text);
      showCopyFeedback(buttonEl);
    });
  };

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function showCopyFeedback(buttonEl) {
    if (!buttonEl) return;
    var span = buttonEl.querySelector('.vy-copy-feedback') || document.createElement('span');
    if (!span.classList) span.className = 'vy-copy-feedback';
    span.className = 'vy-copy-feedback';
    span.textContent = 'Copied!';
    if (!span.parentNode) buttonEl.appendChild(span);
    setTimeout(function () {
      span.textContent = '';
    }, 2000);
  }

  window.vyExpertId = function () {
    var m = /\/vy-experts\/expert\/([^/]+)/.exec(window.location.pathname);
    return m ? m[1] : null;
  };
})();
