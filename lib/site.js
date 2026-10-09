/* p14m shared chrome: theme toggle, current-page marking, "New" pills.
   Theme class is applied before paint by the inline snippet in each page;
   this file only wires the button and keeps the label honest. */
(function () {
  'use strict';

  function syncToggle() {
    var dark = document.body.classList.contains('dark');
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].removeAttribute('aria-pressed');
      btns[i].setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      btns[i].textContent = dark ? 'Light' : 'Dark';
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

  // <el data-new-until="YYYY-MM-DD"> gets a "New" pill through the end of that day
  function markNew(root) {
    var els = (root || document).querySelectorAll('[data-new-until]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var until = new Date(el.getAttribute('data-new-until') + 'T23:59:59');
      if (!(Date.now() <= until.getTime()) || el.querySelector('.new-pill')) continue;
      var pill = document.createElement('span');
      pill.className = 'new-pill';
      pill.textContent = 'New';
      el.appendChild(pill);
    }
  }
  window.p14mMarkNew = markNew;

  function init() { syncToggle(); markCurrent(); markNew(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
