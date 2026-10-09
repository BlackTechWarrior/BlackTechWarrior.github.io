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
    var links = document.querySelectorAll('.tool-strip a, .site-links a, .app-nav a');
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

  // Navigation drawer on narrow screens
  function initNav() {
    var btn = document.querySelector('.nav-toggle');
    var scrim = document.querySelector('.nav-scrim');
    if (!btn) return;
    function set(open) {
      document.body.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function () { set(!document.body.classList.contains('nav-open')); });
    if (scrim) scrim.addEventListener('click', function () { set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
  }

  // Sliders show their filled part through --fill
  function initRanges() {
    var ranges = document.querySelectorAll('input[type="range"]');
    function paint(r) {
      var min = +r.min || 0, max = +r.max || 100;
      r.style.setProperty('--fill', ((r.value - min) / (max - min) * 100) + '%');
    }
    for (var i = 0; i < ranges.length; i++) {
      paint(ranges[i]);
      ranges[i].addEventListener('input', function (e) { paint(e.target); });
    }
  }

  // Modal explanation sheet: p14mSheet({ title, html }) opens it; Esc, Close or the backdrop close it
  var sheet = null;
  window.p14mSheet = function (opts) {
    if (!sheet) {
      sheet = document.createElement('dialog');
      sheet.className = 'sheet';
      sheet.setAttribute('aria-labelledby', 'sheet-title');
      sheet.innerHTML = '<div class="sheet-head"><h2 id="sheet-title"></h2>' +
        '<button class="btn-t" type="button" data-sheet-close>Close</button></div><div class="sheet-body"></div>';
      document.body.appendChild(sheet);
      sheet.querySelector('[data-sheet-close]').addEventListener('click', function () { sheet.close(); });
      sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.close(); });
    }
    sheet.querySelector('#sheet-title').textContent = opts.title;
    sheet.querySelector('.sheet-body').innerHTML = opts.html;
    sheet.querySelector('.sheet-body').scrollTop = 0;
    if (!sheet.open) sheet.showModal();
  };

  function init() { syncToggle(); markCurrent(); markNew(); initNav(); initRanges(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
