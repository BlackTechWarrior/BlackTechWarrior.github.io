/* p14m shared chrome: theme toggle + current-page marking.
   Theme class is applied before paint by the inline snippet in each page;
   this file only wires the button and keeps the label honest. */
(function () {
  'use strict';

  function syncToggle() {
    var dark = document.body.classList.contains('dark');
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', dark ? 'true' : 'false');
      btns[i].setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      btns[i].textContent = 'Dark';
    }
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', dark ? '#101214' : '#F4F5F7');
  }

  window.toggleTheme = function () {
    var body = document.body;
    var dark = !body.classList.contains('dark');
    body.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    syncToggle();
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: dark } }));
  };

  function markCurrent() {
    var path = location.pathname.replace(/index\.html$/, '');
    var links = document.querySelectorAll('.tool-strip a, .site-links a');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!href || href.indexOf('#') !== -1) continue;
      var target = href;
      if (target && target === path) links[i].setAttribute('aria-current', 'page');
    }
    var cur = document.querySelector('.tool-strip a[aria-current="page"]');
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    }
  }

  function init() { syncToggle(); markCurrent(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
