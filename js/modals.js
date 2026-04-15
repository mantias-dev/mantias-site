/**
 * MANTIAS — Modal controller
 * ──────────────────────────
 * 1. Fetches partials/modals.html and injects it into <body>.
 * 2. Wires [data-modal="id"] triggers to #modal-{id} dialogs.
 * Close via: overlay click · close button · Escape key.
 *
 * Edit legal text in: partials/modals.html
 * NOTE: fetch() requires a server (file:// won't work).
 *       Run via `npx serve .` or any static server locally.
 */

(function () {
  var activeModal = null;

  function open(id) {
    var el = document.getElementById('modal-' + id);
    if (!el) return;
    if (activeModal) close();
    el.hidden = false;
    document.body.classList.add('modal-open');
    activeModal = el;
    var btn = el.querySelector('.modal__close');
    if (btn) btn.focus();
  }

  function close() {
    if (!activeModal) return;
    activeModal.hidden = true;
    document.body.classList.remove('modal-open');
    activeModal = null;
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-modal]');
      if (trigger) { open(trigger.dataset.modal); return; }
      if (e.target.closest('.modal__close')) { close(); return; }
      if (e.target.classList.contains('modal')) { close(); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  // Inject partial then bind
  fetch('partials/modals.html')
    .then(function (r) {
      if (!r.ok) throw new Error('Could not load partials/modals.html');
      return r.text();
    })
    .then(function (html) {
      var container = document.createElement('div');
      container.innerHTML = html;
      while (container.firstChild) {
        document.body.appendChild(container.firstChild);
      }
      bindEvents();
    })
    .catch(function (err) {
      // Fallback: modals may already be in the DOM (dev/offline)
      bindEvents();
      console.warn('Mantias modals:', err.message);
    });

}());
