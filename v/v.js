/*
 * mantias.ch/v/ — NFC business card → vCard, entirely client-side.
 *
 * Contact data lives in the URL fragment (#v=1&g=…), which browsers never
 * send to the server. This script reads location.hash, renders a preview,
 * builds a vCard 3.0 in memory, opens it right away as a Blob URL (iOS Safari
 * shows the contact preview), and offers "Add to Contacts" (share sheet /
 * download) as the explicit fallback.
 *
 * Privacy rules enforced here:
 *   - no network requests of any kind (no fetch/XHR/beacon/forms)
 *   - no storage of any kind (cookies, web storage, databases)
 *   - no console output of the URL or contact fields
 *   - all fragment values treated as untrusted; rendered via textContent
 *
 * Classic script (no modules) so it runs under a strict CSP with script-src 'self'.
 * Pure functions are exposed on globalThis.MantiasVCard for unit tests.
 */
(function () {
  'use strict';

  var SUPPORTED_VERSION = '1';
  var MAX_HASH_LENGTH = 4096;   // NTAG215 holds ~500 bytes; anything larger is not ours
  var MAX_FIELD_LENGTH = 200;
  var MAX_ADDRESS_LENGTH = 400;

  // ── Parsing ───────────────────────────────────────────────────────────────

  /** Remove control characters, collapse whitespace, cap length. */
  function cleanField(value, max, multiline) {
    if (typeof value !== 'string') return '';
    var s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (multiline) s = s.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').replace(/ *\n */g, '\n');
    else s = s.replace(/[\r\n]+/g, ' ');
    s = s.replace(/[ \t]+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max);
    return s;
  }

  /** Keep only characters that belong in a dialable number. */
  function cleanPhone(value) {
    var s = cleanField(value, MAX_FIELD_LENGTH).replace(/[^0-9+()\-. /]/g, '').trim();
    return /\d/.test(s) ? s : '';
  }

  function cleanEmail(value) {
    var s = cleanField(value, MAX_FIELD_LENGTH);
    // Loose shape check: something@something.something, no whitespace.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
  }

  /** Returns { href, display } or null. Only http(s) may become a link. */
  function cleanUrl(value) {
    var s = cleanField(value, MAX_FIELD_LENGTH);
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    var display = u.host + (u.pathname === '/' ? '' : u.pathname) + u.search;
    return { href: u.href, display: display };
  }

  /** LinkedIn: accepts a handle or a profile URL; returns { href, handle } or null. */
  function cleanLinkedIn(value) {
    var s = cleanField(value, MAX_FIELD_LENGTH);
    if (!s) return null;
    var m = /(?:linkedin\.com\/in\/)?([A-Za-z0-9\-_%.]+)\/?$/.exec(s);
    if (!m) return null;
    var handle = m[1];
    if (!/^[A-Za-z0-9\-_%.]{2,100}$/.test(handle)) return null;
    return { handle: handle, href: 'https://www.linkedin.com/in/' + handle + '/' };
  }

  /**
   * Parse a location.hash string into a contact object.
   * Returns { ok: true, contact } or { ok: false, reason }.
   * Never throws.
   */
  function parseFragment(hash) {
    try {
      if (typeof hash !== 'string') return { ok: false, reason: 'empty' };
      var raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
      if (!raw) return { ok: false, reason: 'empty' };
      if (raw.length > MAX_HASH_LENGTH) return { ok: false, reason: 'too-long' };

      // URLSearchParams decodes leniently: malformed %XX is kept literally,
      // invalid UTF-8 becomes U+FFFD. It does not throw, but we guard anyway.
      var params = new URLSearchParams(raw);

      if (params.get('v') !== SUPPORTED_VERSION) return { ok: false, reason: 'version' };

      var given = cleanField(params.get('g'), MAX_FIELD_LENGTH);
      var family = cleanField(params.get('f'), MAX_FIELD_LENGTH);
      if (!given && !family) return { ok: false, reason: 'name' };

      var contact = {
        given: given,
        family: family,
        org: cleanField(params.get('o'), MAX_FIELD_LENGTH),
        title: cleanField(params.get('t'), MAX_FIELD_LENGTH),
        mobile: cleanPhone(params.get('m')),
        phone: cleanPhone(params.get('p')),
        email: cleanEmail(params.get('e')),
        url: cleanUrl(params.get('w')),
        address: cleanField(params.get('a'), MAX_ADDRESS_LENGTH, true), // street, may hold a 2nd line
        postcode: cleanField(params.get('z'), MAX_FIELD_LENGTH),
        city: cleanField(params.get('c'), MAX_FIELD_LENGTH),
        region: cleanField(params.get('r'), MAX_FIELD_LENGTH),
        country: cleanField(params.get('k'), MAX_FIELD_LENGTH),
        linkedin: cleanLinkedIn(params.get('l')),
      };
      return { ok: true, contact: contact };
    } catch (e) {
      return { ok: false, reason: 'invalid' };
    }
  }

  // ── vCard 3.0 ─────────────────────────────────────────────────────────────

  /** RFC 2426 text escaping: backslash, semicolon, comma, newline. */
  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function utf8Length(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  /** Fold a content line at 75 octets (RFC 2426 §2.6), never splitting a surrogate pair. */
  function foldLine(line) {
    var out = [];
    var current = '';
    var bytes = 0;
    var limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var code = line.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) { ch += line.charAt(i + 1); i++; }
      var len = utf8Length(ch);
      if (bytes + len > limit) {
        out.push(current);
        current = ' ';
        bytes = 1;
        limit = 75;
      }
      current += ch;
      bytes += len;
    }
    out.push(current);
    return out.join('\r\n');
  }

  function hasAddress(contact) {
    return !!(contact.address || contact.city || contact.postcode || contact.region || contact.country);
  }

  /** Multi-line address for display: street lines, then "postcode city", region, country. */
  function formatAddress(contact) {
    var lines = [];
    if (contact.address) lines.push(contact.address);
    var cityLine = [contact.postcode, contact.city].filter(Boolean).join(' ');
    if (cityLine) lines.push(cityLine);
    if (contact.region) lines.push(contact.region);
    if (contact.country) lines.push(contact.country);
    return lines.join('\n');
  }

  function fullName(contact) {
    return [contact.given, contact.family].filter(Boolean).join(' ');
  }

  /** Build a vCard 3.0 string with CRLF line endings. Optional fields only when present. */
  function buildVCard(contact, opts) {
    opts = opts || {};
    var lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:' + escapeText(contact.family) + ';' + escapeText(contact.given) + ';;;',
      'FN:' + escapeText(fullName(contact)),
    ];
    if (contact.org) lines.push('ORG:' + escapeText(contact.org));
    if (contact.title) lines.push('TITLE:' + escapeText(contact.title));
    if (contact.mobile) lines.push('TEL;TYPE=CELL:' + escapeText(contact.mobile));
    if (contact.phone) lines.push('TEL;TYPE=WORK,VOICE:' + escapeText(contact.phone));
    if (contact.email) lines.push('EMAIL;TYPE=INTERNET:' + escapeText(contact.email));
    if (contact.url) lines.push('URL:' + escapeText(contact.url.href));
    if (contact.linkedin) {
      // Apple extension: Contacts on iOS/macOS shows this as a LinkedIn profile.
      lines.push('X-SOCIALPROFILE;type=linkedin:' + escapeText(contact.linkedin.href));
      // Android Contacts ignores X-SOCIALPROFILE; it does keep a labelled URL.
      if (opts.socialAsUrl) lines.push('URL;TYPE=LinkedIn:' + escapeText(contact.linkedin.href));
    }
    if (hasAddress(contact)) {
      // ADR: po-box;extended;street;locality;region;postal-code;country
      lines.push('ADR;TYPE=WORK:;;' + escapeText(contact.address) + ';' + escapeText(contact.city) + ';' +
        escapeText(contact.region) + ';' + escapeText(contact.postcode) + ';' + escapeText(contact.country));
    }
    lines.push('END:VCARD');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  /** Safe file name derived from the contact's name. */
  function fileName(contact) {
    var base = fullName(contact)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return (base || 'contact') + '.vcf';
  }

  /** Human-friendly phone display. Swiss numbers get +41 XX XXX XX XX; others pass through. */
  function formatPhone(phone) {
    var digits = phone.replace(/[^\d+]/g, '');
    var m = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(digits);
    if (m) return '+41 ' + m[1] + ' ' + m[2] + ' ' + m[3] + ' ' + m[4];
    return phone;
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  function init() {
    var doc = document;
    var els = {
      card: doc.getElementById('card'),
      empty: doc.getElementById('empty'),
      name: doc.getElementById('name'),
      role: doc.getElementById('role'),
      details: doc.getElementById('details'),
      add: doc.getElementById('add'),
      fallback: doc.getElementById('fallback'),
      status: doc.getElementById('status'),
    };

    var result = parseFragment(location.hash);
    if (!result.ok) {
      els.empty.hidden = false;
      return;
    }
    var contact = result.contact;

    // Preview — everything via textContent, never markup.
    els.name.textContent = fullName(contact);
    var roleParts = [contact.title, contact.org].filter(Boolean);
    if (roleParts.length) {
      els.role.textContent = roleParts.join(' · ');
      els.role.hidden = false;
    }

    function addDetail(label, text, href) {
      var row = doc.createElement('div');
      row.className = 'row';
      var dt = doc.createElement('dt');
      dt.textContent = label;
      var dd = doc.createElement('dd');
      var node;
      if (href) {
        node = doc.createElement('a');
        node.href = href;
        node.rel = 'noopener noreferrer';
      } else {
        node = doc.createElement('span');
      }
      node.textContent = text;
      dd.appendChild(node);
      row.appendChild(dt);
      row.appendChild(dd);
      els.details.appendChild(row);
    }

    if (contact.mobile) addDetail('mobile', formatPhone(contact.mobile), 'tel:' + contact.mobile.replace(/[^\d+]/g, ''));
    if (contact.phone) addDetail('phone', formatPhone(contact.phone), 'tel:' + contact.phone.replace(/[^\d+]/g, ''));
    if (contact.email) addDetail('email', contact.email, 'mailto:' + contact.email);
    if (contact.url) addDetail('web', contact.url.display, contact.url.href);
    if (contact.linkedin) addDetail('linkedin', 'linkedin.com/in/' + contact.linkedin.handle, contact.linkedin.href);
    if (hasAddress(contact)) addDetail('address', formatAddress(contact));

    els.card.hidden = false;

    var vcf = null;       // built lazily, in memory only
    var objectUrl = null;

    function getVCard() {
      if (vcf === null) vcf = buildVCard(contact, { socialAsUrl: !isIOS() });
      return vcf;
    }

    function setStatus(text) {
      els.status.textContent = text || '';
    }

    /** Fallback: same-origin Blob URL + download attribute. Nothing leaves the device. */
    function download() {
      var blob = new Blob([getVCard()], { type: isIOS() ? 'text/vcard;charset=utf-8' : 'text/x-vcard' });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      var name = fileName(contact);

      // Keep a visible link so the user can retry / long-press if the auto-click is blocked.
      els.fallback.href = objectUrl;
      els.fallback.download = name;
      els.fallback.hidden = false;

      var a = doc.createElement('a');
      a.href = objectUrl;
      a.download = name;
      a.rel = 'noopener';
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setStatus(isAndroid()
        ? 'Saved ' + name + '. Tap Open in the download bar to add it to Contacts.'
        : 'Downloaded ' + name + '. Open it to add the contact.');
    }

    /**
     * Auto path (no gesture needed): navigate to a same-origin Blob URL of the vCard.
     * iOS Safari renders text/vcard inline as a contact preview with
     * "Create New Contact"; other browsers download the file. If the browser
     * blocks it, the preview + button below remain as the fallback.
     */
    function openInline() {
      var ios = isIOS();
      // iOS Safari renders text/vcard inline. Android Contacts registers text/x-vcard,
      // so a download with that type gets an "Open" action straight into the import dialog.
      var blob = new Blob([getVCard()], { type: ios ? 'text/vcard;charset=utf-8' : 'text/x-vcard' });
      objectUrl = URL.createObjectURL(blob);
      els.fallback.href = objectUrl;
      els.fallback.download = fileName(contact);
      els.fallback.hidden = false;
      if (ios) setStatus('If nothing opened, tap Add to contacts.');
      else if (isAndroid()) setStatus('Saved ' + fileName(contact) + '. Tap Open in the download bar to add it to Contacts.');
      else setStatus('Downloaded ' + fileName(contact) + '. Open it to add the contact.');
      if (ios) {
        // Safari renders text/vcard inline → contact preview with "Create New Contact".
        location.assign(objectUrl);
      } else {
        // Elsewhere a navigation would save the file under the blob UUID; use a named download.
        var a = doc.createElement('a');
        a.href = objectUrl;
        a.download = fileName(contact);
        a.rel = 'noopener';
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
      }
    }

    function share() {
      // Chrome on Android rejects vCard files in the Web Share API (file-type allowlist),
      // and a text/plain share never offers Contacts. The download → "Open" path does.
      if (isAndroid()) {
        download();
        return;
      }
      var file;
      try {
        file = new File([getVCard()], fileName(contact), { type: 'text/vcard' });
      } catch (e) {
        file = null;
      }
      var canShareFiles = false;
      try {
        canShareFiles = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
      } catch (e) {
        canShareFiles = false;
      }
      if (!canShareFiles) {
        download();
        return;
      }
      setStatus('');
      navigator.share({ files: [file] }).then(function () {
        setStatus('');
      }, function (err) {
        // AbortError = user dismissed the sheet; anything else → offer the download.
        if (err && err.name === 'AbortError') return;
        download();
      });
    }

    var autoTried = false;
    function autoOpen() {
      if (autoTried) return;
      autoTried = true;
      try { openInline(); } catch (e) { /* stay on the preview; the button still works */ }
    }
    // Short delay so the preview is painted first, in case the browser blocks the navigation.
    setTimeout(autoOpen, 300);
    addEventListener('pageshow', function (ev) { if (ev.persisted) autoTried = true; });

    els.add.addEventListener('click', function (ev) {
      ev.preventDefault();
      try {
        share();
      } catch (e) {
        try { download(); } catch (e2) { setStatus('Could not create the contact file.'); }
      }
    });
  }

  // Test hooks (pure functions only).
  var api = {
    parseFragment: parseFragment,
    buildVCard: buildVCard,
    escapeText: escapeText,
    foldLine: foldLine,
    fileName: fileName,
    formatPhone: formatPhone,
    fullName: fullName,
    formatAddress: formatAddress,
  };
  if (typeof globalThis !== 'undefined') globalThis.MantiasVCard = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
