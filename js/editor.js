/* Code editor: a native <textarea> (so selection, copy/paste, IME and mobile keyboards just work)
 * layered over a syntax-highlighted <pre>, with a line-number gutter and issue markers. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util;
  var esc = U.escapeHtml;

  var JS_KW = /^(?:const|let|var|function|return|if|else|for|while|do|break|continue|new|class|extends|typeof|instanceof|in|of|switch|case|default|try|catch|finally|throw|this|null|undefined|true|false|async|await|import|export|from|delete|void|yield|super)$/;

  function highlightJS(src) {
    var out = '', re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|([^\w\s])/g;
    var last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += '<span class="t-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="t-str">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="t-num">' + m[3] + '</span>';
      else if (m[4]) {
        if (JS_KW.test(m[4])) out += '<span class="t-kw">' + m[4] + '</span>';
        else if (m[5]) out += '<span class="t-fn">' + m[4] + '</span>';
        else out += esc(m[4]);
        if (m[5]) out += esc(m[5]);
      } else if (m[6]) out += /[{}()[\]]/.test(m[6]) ? '<span class="t-br">' + esc(m[6]) + '</span>' : '<span class="t-op">' + esc(m[6]) + '</span>';
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  function highlightHTML(src) {
    return esc(src)
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="t-com">$1</span>')
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="t-kw">$2</span>')
      .replace(/([\w-]+)=(&quot;[^&]*?&quot;)/g, '<span class="t-fn">$1</span>=<span class="t-str">$2</span>');
  }
  function highlightCSS(src) {
    return esc(src)
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="t-com">$1</span>')
      .replace(/^([^{}\n:]+)(\{)/gm, '<span class="t-fn">$1</span>$2')
      .replace(/([\w-]+)(\s*:)(?![^<]*<\/span>)/g, '<span class="t-kw">$1</span>$2')
      .replace(/(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|s|vh|vw)?\b)/g, '<span class="t-num">$1</span>');
  }

  function Editor(container, opts) {
    this.opts = opts || {};
    this.lang = 'js';
    this.issues = [];
    this.runtimeLine = null;
    this._raf = 0;
    var wrap = U.el('div.editor');
    this.gutter = U.el('div.ed-gutter', { attrs: { 'aria-hidden': 'true' } });
    this.gutterInner = U.el('div.ed-gutter-inner');
    this.gutter.appendChild(this.gutterInner);
    var area = U.el('div.ed-area');
    this.marks = U.el('div.ed-marks', { attrs: { 'aria-hidden': 'true' } });
    this.pre = U.el('pre.ed-highlight', { attrs: { 'aria-hidden': 'true' } });
    this.ta = U.el('textarea.ed-input', { attrs: { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': 'Code editor', 'data-gramm': 'false' } });
    area.appendChild(this.marks); area.appendChild(this.pre); area.appendChild(this.ta);
    wrap.appendChild(this.gutter); wrap.appendChild(area);
    this.status = U.el('div.ed-status');
    container.appendChild(wrap);
    container.appendChild(this.status);
    this.el = wrap;
    this._bind();
  }

  Editor.prototype._bind = function () {
    var self = this, ta = this.ta;
    this._onInput = function () { self._schedule(); if (self.opts.onChange) self.opts.onChange(ta.value); };
    this._onScroll = function () { self._sync(); };
    this._onSel = function () { self._cursor(); };
    this._onKey = function (e) { self._key(e); };
    ta.addEventListener('input', this._onInput);
    ta.addEventListener('scroll', this._onScroll);
    ta.addEventListener('keyup', this._onSel);
    ta.addEventListener('click', this._onSel);
    ta.addEventListener('select', this._onSel);
    ta.addEventListener('keydown', this._onKey);
    ta.addEventListener('focus', function () { if (self.opts.onFocus) self.opts.onFocus(true); });
    ta.addEventListener('blur', function () { if (self.opts.onFocus) self.opts.onFocus(false); });
  };

  Editor.prototype.destroy = function () {
    cancelAnimationFrame(this._raf);
    this.ta.removeEventListener('input', this._onInput);
    this.ta.removeEventListener('scroll', this._onScroll);
    this.ta.removeEventListener('keydown', this._onKey);
  };

  Editor.prototype.setValue = function (text, lang) {
    this.lang = lang || this.lang;
    this.ta.value = text;
    this.runtimeLine = null;
    this.ta.scrollTop = 0; this.ta.scrollLeft = 0;
    this.render();
    this._cursor();
  };
  Editor.prototype.getValue = function () { return this.ta.value; };
  Editor.prototype.focus = function () { try { this.ta.focus({ preventScroll: true }); } catch (e) { this.ta.focus(); } };

  // Replace [start,end) keeping native undo when the browser supports it.
  Editor.prototype.replaceRange = function (start, end, text) {
    var ta = this.ta;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    var ok = false;
    try { ok = document.execCommand && document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  // Replace the whole text with a minimal edit (so undo only covers the changed part).
  Editor.prototype.applyText = function (next) {
    var cur = this.ta.value;
    if (cur === next) return;
    var s = 0; while (s < cur.length && s < next.length && cur[s] === next[s]) s++;
    var e1 = cur.length, e2 = next.length;
    while (e1 > s && e2 > s && cur[e1 - 1] === next[e2 - 1]) { e1--; e2--; }
    this.replaceRange(s, e1, next.slice(s, e2));
  };
  Editor.prototype.insertAtCursor = function (text) {
    this.replaceRange(this.ta.selectionStart, this.ta.selectionEnd, text);
  };

  Editor.prototype._key = function (e) {
    var ta = this.ta;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) { // outdent current line
        var ls = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        var n = /^ {1,2}/.exec(ta.value.slice(ls));
        if (n) { var pos = ta.selectionStart; this.replaceRange(ls, ls + n[0].length, ''); ta.setSelectionRange(Math.max(ls, pos - n[0].length), Math.max(ls, pos - n[0].length)); }
      } else this.insertAtCursor('  ');
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing) {
      var start = ta.selectionStart, before = ta.value.slice(0, start);
      var line = before.slice(before.lastIndexOf('\n') + 1);
      var indent = /^\s*/.exec(line)[0];
      var prevChar = before.trimEnd().slice(-1);
      var nextChar = ta.value.slice(ta.selectionEnd).trimStart().charAt(0);
      if (prevChar === '{' || prevChar === '(' || prevChar === '[') {
        e.preventDefault();
        if ((prevChar === '{' && nextChar === '}') || (prevChar === '(' && nextChar === ')') || (prevChar === '[' && nextChar === ']')) {
          this.insertAtCursor('\n' + indent + '  \n' + indent);
          ta.setSelectionRange(start + indent.length + 3, start + indent.length + 3);
        } else this.insertAtCursor('\n' + indent + '  ');
      } else if (indent) { e.preventDefault(); this.insertAtCursor('\n' + indent); }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); if (this.opts.onSave) this.opts.onSave();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault(); if (this.opts.onRun) this.opts.onRun();
    } else if (e.key === 'Escape') {
      this.ta.blur();
    }
  };

  Editor.prototype._schedule = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self.render(); });
  };

  Editor.prototype.setIssues = function (issues) { this.issues = issues || []; this.render(); };
  Editor.prototype.setRuntimeLine = function (line) { this.runtimeLine = line; this.render(); };

  Editor.prototype.render = function () {
    var text = this.ta.value;
    var html = this.lang === 'js' ? highlightJS(text) : this.lang === 'html' ? highlightHTML(text) : this.lang === 'css' ? highlightCSS(text) : esc(text);
    var count = text.split('\n').length;
    var marks = {};
    this.issues.forEach(function (i) {
      var sev = i.severity === 'error' ? 3 : i.severity === 'warning' ? 2 : 1;
      for (var l = i.line; l <= (i.endLine || i.line); l++) marks[l] = Math.max(marks[l] || 0, sev);
    });
    if (this.runtimeLine) marks[this.runtimeLine] = 4;
    var cls = ['', 'm-info', 'm-warn', 'm-err', 'm-run'];
    this.pre.innerHTML = html + '\n ';
    // Line backgrounds live in their own layer, positioned with the same line-height variable.
    this.marks.innerHTML = Object.keys(marks).map(function (l) {
      return '<div class="mk ' + cls[marks[l]] + '" style="top:calc(' + (l - 1) + ' * var(--lh) + var(--pad))"></div>';
    }).join('');
    var g = [];
    for (var i = 1; i <= count; i++) g.push('<div class="gl' + (marks[i] ? ' ' + cls[marks[i]] : '') + '" data-line="' + i + '">' + i + '</div>');
    this.gutterInner.innerHTML = g.join('');
    this._sync();
  };

  Editor.prototype._sync = function () {
    var x = this.ta.scrollLeft, y = this.ta.scrollTop;
    this.pre.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    this.marks.style.transform = 'translateY(' + (-y) + 'px)';
    this.gutterInner.style.transform = 'translateY(' + (-y) + 'px)';
  };

  Editor.prototype._cursor = function () {
    var pos = this.ta.selectionStart, before = this.ta.value.slice(0, pos);
    var line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
    this.status.textContent = 'Ln ' + line + ', Col ' + col + (this.opts.label ? ' · ' + this.opts.label() : '');
    if (this.opts.onCursor) this.opts.onCursor(line, col);
  };

  Editor.prototype.cursorLine = function () { return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length; };

  Editor.prototype.gotoLine = function (line, col) {
    var lines = this.ta.value.split('\n');
    line = U.clamp(line || 1, 1, lines.length);
    var pos = 0;
    for (var i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    pos += Math.max(0, Math.min((col || 1) - 1, lines[line - 1].length));
    this.focus();
    this.ta.setSelectionRange(pos, pos);
    var lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    this.ta.scrollTop = Math.max(0, (line - 4) * lh);
    this._sync(); this._cursor();
    var gl = this.gutterInner.querySelector('[data-line="' + line + '"]');
    if (gl) { gl.classList.add('flash'); setTimeout(function () { gl.classList.remove('flash'); }, 900); }
  };

  Editor.highlightJS = highlightJS;
  CM.Editor = Editor;
})(typeof self !== 'undefined' ? self : this);
