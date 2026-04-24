/* ─────────────────────────────────────────────────────────────
   p14m feedback widget — "Was this useful?" signal.
   Drop-in: <div class="feedback-box" data-topic="tool-<name>"
                 data-label="Was this tool useful?"></div>
   and include this script (defer) anywhere on the page.

   Cost model: no Firestore reads. Pages only *write* on click
   (once per browser, deduped via localStorage). Counts are kept
   in Firestore for the admin (viewable in the Firebase console)
   and are not shown to visitors.

   Firebase SDK is lazy-loaded on first click so pages stay fast
   and users who never vote pay zero bandwidth beyond this file.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDjXO28mfjl3L85F91DhWuaYNMIvYcDdPM',
    authDomain: 'p14m-helpful-counter.firebaseapp.com',
    projectId: 'p14m-helpful-counter',
    storageBucket: 'p14m-helpful-counter.firebasestorage.app',
    messagingSenderId: '109214087494',
    appId: '1:109214087494:web:6affe1ce6be75c1d298d47'
  };

  var _ready = null;

  function loadFirebase() {
    if (_ready) return _ready;
    _ready = new Promise(function (resolve) {
      var s1 = document.createElement('script');
      s1.src = 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js';
      s1.onload = function () {
        var s2 = document.createElement('script');
        s2.src = 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore-compat.js';
        s2.onload = function () {
          try {
            if (!window.firebase.apps || !window.firebase.apps.length) {
              firebase.initializeApp(FIREBASE_CONFIG);
            }
            resolve(firebase.firestore());
          } catch (_) { resolve(null); }
        };
        s2.onerror = function () { resolve(null); };
        document.head.appendChild(s2);
      };
      s1.onerror = function () { resolve(null); };
      document.head.appendChild(s1);
    });
    return _ready;
  }

  function getVote(topicId) { return localStorage.getItem('feedback_' + topicId); }
  function setVote(topicId) { localStorage.setItem('feedback_' + topicId, 'yes'); }

  function writeVote(topicId) {
    loadFirebase().then(function (db) {
      if (!db) return;
      try {
        db.collection('feedback').doc(topicId).set(
          { helpful: firebase.firestore.FieldValue.increment(1) },
          { merge: true }
        );
      } catch (_) { /* ignore */ }
    });
  }

  function mount(el) {
    var topicId = el.dataset.topic;
    if (!topicId) return;
    var label = (el.dataset.label || 'Helpful?').replace(/</g, '&lt;');
    var voted = !!getVote(topicId);

    function renderVoted() {
      el.innerHTML =
        '<div class="feedback-btns">' +
          '<span class="feedback-btn voted">👍 thanks!</span>' +
        '</div>' +
        '<div class="feedback-thanks">Feedback sent.</div>';
    }

    if (voted) { renderVoted(); return; }

    el.innerHTML =
      '<div class="feedback-btns">' +
        '<button class="feedback-btn" data-helpful type="button">👍 ' + label + '</button>' +
      '</div>';

    el.querySelector('[data-helpful]').addEventListener('click', function () {
      if (getVote(topicId)) { renderVoted(); return; }
      setVote(topicId);
      writeVote(topicId);    // lazy-loads Firebase only here; one write, then done
      renderVoted();
    });
  }

  function init() {
    document.querySelectorAll('.feedback-box[data-topic]').forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
