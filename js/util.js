/* Small shared helpers: DOM, events, timing, string distance. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  // el('div.card#x', {onclick: fn, text: 'hi', attrs:{}}, [children])
  function el(spec, props, children) {
    var m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
    var node = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, t, n) {
      if (t === '.') node.classList.add(n); else node.id = n;
    });
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'attrs') Object.keys(v).forEach(function (a) { node.setAttribute(a, v[a]); });
      else if (k === 'style') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k.indexOf('-') > 0) node.setAttribute(k, v); // data-*, aria-*
      else node[k] = v;
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, wait) {
    var t = null;
    function d() {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, typeof wait === 'function' ? wait() : wait);
    }
    d.cancel = function () { clearTimeout(t); t = null; };
    d.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    return d;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Tiny event bus. on() returns an unsubscribe function so listeners never leak.
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (ev, fn) {
    var list = (this._h[ev] = this._h[ev] || []);
    list.push(fn);
    return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };
  Emitter.prototype.emit = function (ev, data) {
    (this._h[ev] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { CM.reportError(e, 'event:' + ev); }
    });
  };

  // Central error reporter: details to the console, a friendly line on screen.
  var lastToast = 0;
  CM.reportError = function (err, where) {
    try { console.error('[CODEMATE]', where || '', err); } catch (e) { /* ignore */ }
    var now = Date.now();
    if (CM.UI && CM.UI.toast && now - lastToast > 3000) {
      lastToast = now;
      CM.UI.toast('Something went wrong, but the game keeps running.', 'error');
    }
  };
  CM.safe = function (fn, where) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { CM.reportError(e, where); }
    };
  };

  CM.util = { $: $, $all: $all, el: el, escapeHtml: escapeHtml, debounce: debounce, clamp: clamp, lerp: lerp, uid: uid, Emitter: Emitter };
  CM.bus = new Emitter();
})(typeof self !== 'undefined' ? self : this);
