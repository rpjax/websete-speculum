(function speculum_single_tab() {
  'use strict';
  try {
    Object.defineProperty(window, 'opener', {
      value: null,
      writable: false,
      configurable: false,
    });
  } catch (_) {}
  var _origOpen = window.open.bind(window);
  window.open = function speculum_single_tab_open(url, target, features) {
    var href = url instanceof URL ? url.href : String(url || '');
    if (
      href &&
      !href.startsWith('javascript:') &&
      !href.startsWith('about:') &&
      !href.startsWith('blob:')
    ) {
      window.location.href = href;
      return null;
    }
    return _origOpen(url, target, features);
  };
  document.addEventListener(
    'click',
    function (e) {
      if (e.defaultPrevented) return;
      var el = e.target;
      var a = el instanceof Element ? el.closest('a') : null;
      if (!a) return;
      var t = (a.getAttribute('target') || '').toLowerCase();
      if (t !== '_blank' && t !== '_new') return;
      var href = a.href;
      if (
        !href ||
        href.startsWith('javascript:') ||
        href.startsWith('about:') ||
        href.startsWith('blob:')
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      window.location.href = href;
    },
    true,
  );
  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target instanceof HTMLFormElement ? e.target : null;
      if (!form) return;
      var t = (form.getAttribute('target') || '').toLowerCase();
      if (t === '_blank' || t === '_new') form.setAttribute('target', '_self');
    },
    true,
  );
})();
