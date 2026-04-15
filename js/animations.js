/* ══════════════════════════════════════════════════════════
   animations.js — Scroll reveal for sections below the hero
   ──────────────────────────────────────────────────────────
   HOW IT WORKS
   • html.js-motion  (set by inline <head> script) activates
     the CSS hidden state for .reveal elements.
   • This script assigns --reveal-i to sibling .reveal
     elements so CSS can stagger them (0, 85, 170 ms, …).
   • IntersectionObserver adds .is-visible when an element
     crosses the viewport threshold.

   EXTENDING
   • To animate a new element on scroll: class="reveal"
   • Siblings that share the same parent auto-stagger.
   • Override stagger manually: style="--reveal-i: 2"
══════════════════════════════════════════════════════════ */
(function () {

  /* Auto-assign stagger index to .reveal siblings sharing a parent */
  var groups = new Map();
  document.querySelectorAll('.reveal').forEach(function (el) {
    var parent = el.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(el);
  });
  groups.forEach(function (siblings) {
    siblings.forEach(function (el, i) {
      if (i > 0) el.style.setProperty('--reveal-i', i);
    });
  });

  /* Fallback: reveal immediately if IntersectionObserver unavailable */
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('is-visible');
    });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.10,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

})();
