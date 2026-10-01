/* Toasts and modal dialogs (confirm / prompt / choose) — no native alert/prompt so it works everywhere. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  var openModals = 0;

  function modal(build) {
    return new Promise(function (resolve) {
      var rootEl = document.getElementById('modal-root');
      var prevFocus = document.activeElement;
      var overlay = el('div.modal-overlay', { attrs: { role: 'dialog', 'aria-modal': 'true' } });
      var box = el('div.modal');
      overlay.appendChild(box);
      var done = function (v) {
        if (!overlay.parentNode) return;
        overlay.parentNode.removeChild(overlay);
        openModals--;
        document.removeEventListener('keydown', onKey, true);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        resolve(v);
      };
      var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      overlay.addEventListener('pointerdown', function (e) { if (e.target === overlay) done(null); });
      build(box, done);
      openModals++;
      rootEl.appendChild(overlay);
      var f = box.querySelector('input, textarea, select') || box.querySelector('button.primary') || box.querySelector('button');
      if (f) setTimeout(function () { f.focus(); }, 30);
    });
  }

  var UI = {
    modalOpen: function () { return openModals > 0; },

    toast: function (text, kind, ms) {
      var host = document.getElementById('toasts');
      if (!host) return;
      var t = el('div.toast.' + (kind || 'info'), { text: text, attrs: { role: 'status' } });
      host.appendChild(t);
      while (host.children.length > 4) host.removeChild(host.firstChild);
      setTimeout(function () { t.classList.add('out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, ms || 2600);
    },

    confirm: function (title, text, okLabel, danger) {
      return modal(function (box, done) {
        box.appendChild(el('h3', { text: title }));
        if (text) box.appendChild(el('p', { text: text }));
        box.appendChild(el('div.modal-actions', {}, [
          el('button.btn', { text: 'CANCEL', onclick: function () { done(false); } }),
          el('button.btn.primary' + (danger ? '.danger' : ''), { text: okLabel || 'OK', onclick: function () { done(true); } })
        ]));
      }).then(function (v) { return !!v; });
    },

    // validate(value) -> error string or null
    prompt: function (title, value, placeholder, validate) {
      return modal(function (box, done) {
        var input = el('input.input', { value: value || '', attrs: { placeholder: placeholder || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' } });
        var err = el('div.modal-error');
        var submit = function () {
          var v = input.value.trim(), e = validate ? validate(v) : (v ? null : '값을 입력해줘.');
          if (e) { err.textContent = e; input.focus(); return; }
          done(v);
        };
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        box.appendChild(el('h3', { text: title }));
        box.appendChild(input);
        box.appendChild(err);
        box.appendChild(el('div.modal-actions', {}, [
          el('button.btn', { text: 'CANCEL', onclick: function () { done(null); } }),
          el('button.btn.primary', { text: 'OK', onclick: submit })
        ]));
      });
    },

    // options: [{value, label, desc, disabled}]
    choose: function (title, options, text) {
      return modal(function (box, done) {
        box.appendChild(el('h3', { text: title }));
        if (text) box.appendChild(el('p', { text: text }));
        var list = el('div.choice-list');
        options.forEach(function (o) {
          list.appendChild(el('button.choice', { disabled: !!o.disabled, onclick: function () { done(o.value); } }, [
            el('strong', { text: o.label }), o.desc ? el('span', { text: o.desc }) : null
          ]));
        });
        box.appendChild(list);
        box.appendChild(el('div.modal-actions', {}, [el('button.btn', { text: 'CANCEL', onclick: function () { done(null); } })]));
      });
    },

    custom: modal
  };

  CM.UI = UI;
})(typeof self !== 'undefined' ? self : this);
