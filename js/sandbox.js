/* Runs player code inside a sandboxed iframe.
 * - sandbox="allow-scripts" without allow-same-origin: no access to the game, cookies or storage
 * - a CSP inside the frame blocks all network requests
 * - every loop gets an iteration/time guard so infinite loops cannot freeze the game
 * - console output and errors (with file + line) are posted back to the game */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var A = function () { return CM.Analyzer; };

  // Runtime injected into the frame. Kept as a plain function so it is real, lintable code.
  function frameRuntime(runId, payload) {
    var send = function (msg) { msg.runId = runId; parent.postMessage(msg, '*'); };
    var sent = 0;
    function fmt(v, depth) {
      depth = depth || 0;
      try {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
        if (typeof v === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
        if (v instanceof Error) return v.name + ': ' + v.message;
        if (typeof Element !== 'undefined' && v instanceof Element) return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>';
        if (depth > 2) return Array.isArray(v) ? '[…]' : '{…}';
        if (Array.isArray(v)) return '[' + v.slice(0, 30).map(function (x) { return fmt(x, depth + 1); }).join(', ') + (v.length > 30 ? ', …' : '') + ']';
        var keys = Object.keys(v).slice(0, 20);
        return '{ ' + keys.map(function (k) { return k + ': ' + fmt(v[k], depth + 1); }).join(', ') + (Object.keys(v).length > 20 ? ', …' : '') + ' }';
      } catch (e) { return String(v); }
    }
    function out(level) {
      return function () {
        if (sent > 300) { if (sent === 301) { sent++; send({ type: 'console', level: 'warn', text: '(output truncated)' }); } return; }
        sent++;
        send({ type: 'console', level: level, text: Array.prototype.map.call(arguments, function (a) { return fmt(a); }).join(' ').slice(0, 2000) });
      };
    }
    console.log = out('log'); console.info = out('log'); console.warn = out('warn'); console.error = out('error'); console.debug = out('log');
    window.alert = function (m) { out('log')('[alert] ' + m); };
    window.confirm = function (m) { out('log')('[confirm] ' + m); return true; };
    window.prompt = function (m) { out('log')('[prompt] ' + m); return null; };
    // loop guard: throws if one task keeps looping for too long
    var armed = false, tStart = 0, count = 0;
    window.__cmGuard = function () {
      if (!armed) { armed = true; tStart = Date.now(); count = 0; setTimeout(function () { armed = false; }, 0); }
      if ((++count & 1023) === 0 && Date.now() - tStart > 1500) { armed = false; throw new RangeError('Infinite loop? This loop ran for too long and was stopped.'); }
    };
    function where(err) {
      var stack = String(err && err.stack || ''), m, re = /([\w.\-]+\.js):(\d+):(\d+)/g;
      while ((m = re.exec(stack))) { if (payload.names.indexOf(m[1]) >= 0) return { file: m[1], line: +m[2], col: +m[3] }; }
      return null;
    }
    var current = null;
    window.addEventListener('error', function (e) {
      var loc = where(e.error) || (current ? { file: current, line: e.lineno, col: e.colno } : null);
      send({ type: 'error', name: e.error && e.error.name || 'Error', message: e.error && e.error.message || e.message, file: loc && loc.file, line: loc && loc.line, col: loc && loc.col });
      e.preventDefault();
    });
    window.addEventListener('unhandledrejection', function (e) {
      var r = e.reason;
      var loc = where(r);
      send({ type: 'error', name: r && r.name || 'Error', message: r && r.message || String(r), file: loc && loc.file, line: loc && loc.line, col: loc && loc.col });
    });
    window.pass = function (m) { send({ type: 'test', pass: true, message: String(m || 'OK') }); };
    window.fail = function (m) { send({ type: 'test', pass: false, message: String(m || 'Failed') }); };
    var errored = false;
    window.addEventListener('error', function () { errored = true; });
    payload.files.forEach(function (f) {
      if (errored) return;
      current = f.name;
      var s = document.createElement('script');
      s.textContent = f.code + '\n//# sourceURL=' + f.name;
      document.body.appendChild(s);
    });
    current = null;
    send({ type: 'done', errored: errored });
  }

  function escapeJson(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

  // Builds the frame document from the project's index.html, inlining style.css and the scripts in order.
  function buildDoc(project, opts) {
    opts = opts || {};
    var files = project.files, byName = {};
    files.forEach(function (f) { byName[f.name] = f; });
    var htmlFile = opts.only ? null : byName['index.html'];
    var order = [], css = [], notes = [];
    var bodyHtml = '', headExtra = '', title = project.name;
    if (htmlFile) {
      var doc = new DOMParser().parseFromString(htmlFile.content, 'text/html');
      Array.prototype.slice.call(doc.querySelectorAll('script')).forEach(function (s) {
        var src = (s.getAttribute('src') || '').replace(/^\.\//, '');
        if (src) { if (byName[src]) order.push(src); else notes.push('index.html: "' + src + '" 파일을 찾을 수 없어.'); }
        else if (s.textContent.trim()) { var n = 'inline-' + order.length + '.js'; byName[n] = { name: n, content: s.textContent }; order.push(n); }
        s.remove();
      });
      Array.prototype.slice.call(doc.querySelectorAll('link[rel="stylesheet"]')).forEach(function (l) {
        var href = (l.getAttribute('href') || '').replace(/^\.\//, '');
        if (byName[href]) css.push(byName[href].content); else notes.push('index.html: "' + href + '" 스타일 파일을 찾을 수 없어.');
        l.remove();
      });
      Array.prototype.slice.call(doc.querySelectorAll('style')).forEach(function (st) { css.push(st.textContent); st.remove(); });
      bodyHtml = doc.body ? doc.body.innerHTML : '';
      title = doc.title || title;
      files.forEach(function (f) { if (/\.js$/.test(f.name) && order.indexOf(f.name) < 0 && !/^mission\d+\.js$/.test(f.name)) notes.push(f.name + '는 index.html에 연결되어 있지 않아서 실행되지 않았어.'); });
    } else {
      order = opts.only ? [opts.only] : files.filter(function (f) { return /\.js$/.test(f.name); }).map(function (f) { return f.name; });
      bodyHtml = '';
    }
    var payloadFiles = [];
    for (var i = 0; i < order.length; i++) {
      var f = byName[order[i]], code = f.content;
      var chk = A().checkSyntax(code);
      if (!chk.ok) return { syntaxError: { file: f.name, line: chk.line, col: chk.col, message: chk.message, friendly: chk.friendly } };
      try { code = A().instrumentLoops(code, '__cmGuard'); } catch (e) { /* keep original */ }
      payloadFiles.push({ name: f.name, code: code });
    }
    if (opts.test) payloadFiles.push({ name: '__mission_test.js', code: opts.test });
    return { order: order, notes: notes, title: title, css: css, bodyHtml: bodyHtml, headExtra: headExtra, files: payloadFiles };
  }

  var Sandbox = {
    frame: null,
    runId: null,
    _handler: null,
    _timer: null,

    stop: function () {
      clearTimeout(this._timer);
      if (this._handler) { window.removeEventListener('message', this._handler); this._handler = null; }
      if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
      this.frame = null; this.runId = null;
    },

    // Runs a project (or a single file with opts.only). Callbacks: onConsole(entry), onDone(result)
    run: function (project, container, opts) {
      opts = opts || {};
      this.stop();
      var built;
      try { built = buildDoc(project, opts); }
      catch (e) { console.error(e); opts.onDone && opts.onDone({ ok: false, error: { name: 'Error', message: 'Could not prepare the program: ' + e.message } }); return; }
      if (built.syntaxError) { opts.onDone && opts.onDone({ ok: false, syntax: true, error: { name: 'SyntaxError', message: built.syntaxError.message, friendly: built.syntaxError.friendly, file: built.syntaxError.file, line: built.syntaxError.line } }); return; }
      built.notes.forEach(function (n) { opts.onConsole && opts.onConsole({ level: 'warn', text: n }); });

      var runId = CM.util.uid('run');
      var payload = { names: built.files.map(function (f) { return f.name; }), files: built.files };
      var csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + CM.util.escapeHtml(built.title) + '</title>' +
        '<style>' + built.css.join('\n').replace(/<\/style/gi, '<\\/style') + '</style></head><body>' + built.bodyHtml +
        '<script>(' + frameRuntime.toString() + ')(' + JSON.stringify(runId) + ',' + escapeJson(payload) + ');<\/script></body></html>';

      var frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('title', 'Program preview');
      frame.className = 'run-frame';
      var self = this, finished = false, errors = [], testResult = null, doneAt = 0;
      var finish = function (extra) {
        if (finished) return;
        finished = true;
        clearTimeout(self._timer);
        var res = { ok: errors.length === 0 && !(extra && extra.timeout), errors: errors, error: errors[0] || (extra && extra.timeout ? { name: 'TimeoutError', message: 'The program did not finish in time.' } : null), test: testResult };
        opts.onDone && opts.onDone(res);
      };
      this._handler = function (e) {
        if (!self.frame || e.source !== self.frame.contentWindow) return;
        var m = e.data;
        if (!m || m.runId !== runId) return;
        if (m.type === 'console') opts.onConsole && opts.onConsole({ level: m.level, text: String(m.text) });
        else if (m.type === 'error') {
          var err = { name: String(m.name || 'Error'), message: String(m.message || ''), file: m.file || null, line: m.line || null, col: m.col || null };
          if (err.file === '__mission_test.js') { err.file = null; err.line = null; }
          if (finished) { opts.onLateError && opts.onLateError(err); return; }
          errors.push(err);
          opts.onConsole && opts.onConsole({ level: 'error', text: err.name + ': ' + err.message + (err.file ? ' (' + err.file + ':' + err.line + ')' : '') });
        } else if (m.type === 'test') testResult = { pass: !!m.pass, message: String(m.message) };
        else if (m.type === 'done') {
          doneAt = Date.now();
          // give async errors (timers/animation frames) a short moment to surface
          setTimeout(function () { finish(); }, opts.settleMs || 700);
        }
      };
      window.addEventListener('message', this._handler);
      this._timer = setTimeout(function () {
        if (!doneAt) { finish({ timeout: true }); self.stop(); }
      }, CM.CONFIG.RUN_TIMEOUT_MS);
      frame.srcdoc = html;
      this.frame = frame;
      this.runId = runId;
      container.appendChild(frame);
    }
  };

  Sandbox._buildDoc = buildDoc;
  CM.Sandbox = Sandbox;
})(typeof self !== 'undefined' ? self : this);
