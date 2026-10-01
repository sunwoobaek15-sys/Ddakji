/* AIService — the one interface the game uses for "AI" work.
 *
 *   analyzeCode(code, opts)       -> local analyzer, synchronous and instant (always)
 *   deepAnalyze(code, ctx)        -> optional online review (opt-in, long debounce)
 *   explainError(err, ctx)        -> online if connected, else local brain
 *   suggestFix(request, ctx)      -> online if connected, else local brain
 *   chat(message, ctx)            -> online if connected, else local brain
 *
 * Game Client -> Backend API (/api/ai/*) -> AI Provider. The browser never sees an API key.
 * Any online failure switches to OFFLINE ANALYZER MODE and the request is answered locally. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  var AIService = {
    status: 'unknown', // unknown | connected | unavailable | disabled
    model: null,
    provider: null,
    lastCheck: 0,
    lastError: null,

    get online() { return this.status === 'connected'; },
    get modeLabel() { return this.online ? 'ONLINE AI MODE' : 'OFFLINE ANALYZER MODE'; },

    init: function () {
      return this.checkHealth();
    },

    checkHealth: function () {
      var self = this;
      this.lastCheck = Date.now();
      if (CM.Store.data.settings.aiMode === 'offline') { this._set('disabled'); return Promise.resolve(false); }
      if (location.protocol === 'file:') { this._set('unavailable', 'Opened as a local file (no backend).'); return Promise.resolve(false); }
      return this._fetch('/health', null, 4000).then(function (res) {
        if (res && res.ai) { self.model = res.model || null; self.provider = res.provider || null; self._set('connected'); return true; }
        self._set('unavailable', 'Backend has no AI provider configured.'); return false;
      }).catch(function (e) { self._set('unavailable', e.message); return false; });
    },

    _set: function (s, why) {
      var prev = this.status;
      this.status = s; this.lastError = why || null;
      if (prev !== s) CM.bus.emit('ai:status', { status: s, prev: prev, why: why });
    },

    _fetch: function (path, body, timeout) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout || 30000);
      return fetch(CM.CONFIG.API_BASE + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        clearTimeout(timer);
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
          return j;
        });
      }, function (e) { clearTimeout(timer); throw e; });
    },

    // Called on any online failure: tell the player once and fall back.
    _fail: function (e) {
      console.warn('[CODEMATE] AI request failed, switching to offline analyzer:', e);
      if (this.status === 'connected') {
        this._set('unavailable', e && e.message);
        CM.UI.toast('AI connection unavailable. Switched to the local analyzer.', 'warn');
        CM.Partner.say('AI connection unavailable.', { state: 'CONFUSED' });
      }
    },
    _maybeRecheck: function () {
      if (this.status === 'unavailable' && Date.now() - this.lastCheck > CM.CONFIG.HEALTH_RETRY_MS) return this.checkHealth();
      return Promise.resolve(this.online);
    },

    analyzeCode: function (code, opts) { return CM.Analyzer.analyze(code, opts); },

    // Context sent to the backend. Only the project being edited, never save data or settings.
    _payload: function (ctx) {
      return {
        file: ctx.file, code: String(ctx.code || '').slice(0, 30000),
        files: (ctx.files || []).map(function (f) { return f.name; }),
        issues: (ctx.issues || []).slice(0, 10).map(function (i) { return { type: i.type, line: i.line, message: i.message }; }),
        lastError: ctx.lastError ? { name: ctx.lastError.name, message: ctx.lastError.message, line: ctx.lastError.line, file: ctx.lastError.file } : null,
        mission: ctx.mission ? { title: ctx.mission.title, goal: ctx.mission.goal } : null,
        partnerName: CM.Partner.name,
        stage: CM.Progress.bondStage()
      };
    },

    deepAnalyze: function (ctx) {
      var self = this;
      if (!this.online || !CM.Store.data.settings.deepAnalysis) return Promise.resolve(null);
      return this._fetch('/ai/analyze', this._payload(ctx), 45000).then(function (r) {
        return (r.issues || []).slice(0, 5).map(function (i, n) {
          return { key: 'ai:' + n + ':' + String(i.message).slice(0, 30), type: i.type === 'STYLE' ? 'STYLE' : 'POSSIBLE_BUG', severity: 'info', line: +i.line || 1, endLine: +i.line || 1, col: 1, title: 'AI review', message: String(i.message).slice(0, 300), confidence: Math.min(0.7, +i.confidence || 0.5), source: 'online' };
        });
      }).catch(function (e) { self._fail(e); return null; });
    },

    explainError: function (err, ctx) {
      var self = this, local = CM.Brain.explainError(err, ctx);
      return this._maybeRecheck().then(function (on) {
        if (!on) return local;
        var p = self._payload(ctx); p.error = { name: err.name, message: err.message, line: err.line, file: err.file };
        return self._fetch('/ai/explain', p, 45000).then(function (r) {
          return { title: local.title, text: String(r.reply || local.text), line: +r.line || local.line, file: local.file, source: 'online' };
        }).catch(function (e) { self._fail(e); return local; });
      });
    },

    // Returns {reply, fix?: {file, code} | {issueKey}, confidence, line, source}
    chat: function (message, ctx) {
      var self = this;
      return this._maybeRecheck().then(function (on) {
        if (!on) { var l = CM.Brain.chat(message, ctx); l.source = 'local'; return l; }
        var p = self._payload(ctx);
        p.message = String(message).slice(0, 2000);
        p.history = (ctx.history || []).slice(-10).map(function (h) { return { role: h.role, text: String(h.text).slice(0, 1500) }; });
        return self._fetch('/ai/chat', p, 60000).then(function (r) {
          var out = { reply: String(r.reply || '...'), confidence: typeof r.confidence === 'number' ? r.confidence : 0.5, line: +r.line || null, source: 'online' };
          if (r.fix && typeof r.fix.code === 'string') out.fix = { file: String(r.fix.file || ctx.file), code: r.fix.code, summary: String(r.fix.summary || '') };
          return out;
        }).catch(function (e) { self._fail(e); var l2 = CM.Brain.chat(message, ctx); l2.source = 'local'; return l2; });
      });
    },

    suggestFix: function (request, ctx) { return this.chat(request || '고쳐줘', ctx); }
  };

  CM.AIService = AIService;
})(typeof self !== 'undefined' ? self : this);
