/* Save system: one versioned JSON document in localStorage with a backup copy.
 * Everything loaded from storage is validated and clamped before use. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var C = CM.CONFIG;

  function canStore() {
    try { var k = '__cm_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
  }

  function defaults() {
    return {
      version: C.SAVE_VERSION,
      settings: { partnerName: C.PARTNER_NAME, aiMode: 'auto', analyzeDelay: C.ANALYZE_DELAY_DEFAULT, joystick: 'auto', devMode: false, deepAnalysis: false },
      progress: {
        xp: 0, achievements: {}, skills: { debugging: 0, syntax: 0, clean: 0, logic: 0 },
        stats: { runs: 0, okRuns: 0, fixes: 0, chats: 0, roomsVisited: [] },
        missions: {}, introSeen: false, awarded: []
      },
      projects: [],
      currentProjectId: null,
      world: { x: 700, y: 560 }
    };
  }

  function str(v, max, fallback) { return typeof v === 'string' ? v.slice(0, max) : fallback; }
  function num(v, a, b, fallback) { return typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : fallback; }
  var FILE_RE = /^[\w.-]{1,40}$/;

  function sanitizeProject(p) {
    if (!p || typeof p !== 'object') return null;
    var files = Array.isArray(p.files) ? p.files : [];
    var seen = {};
    files = files.filter(function (f) {
      if (!f || typeof f.name !== 'string' || !FILE_RE.test(f.name) || seen[f.name]) return false;
      seen[f.name] = true; return true;
    }).slice(0, C.MAX_FILES).map(function (f) { return { name: f.name, content: str(f.content, C.MAX_FILE_CHARS, '') }; });
    if (!files.length) return null;
    return {
      id: str(p.id, 60, CM.util.uid('p')),
      name: str(p.name, 40, 'Untitled') || 'Untitled',
      template: str(p.template, 20, 'blank'),
      created: num(p.created, 0, 9e15, Date.now()),
      updated: num(p.updated, 0, 9e15, Date.now()),
      files: files,
      activeFile: typeof p.activeFile === 'string' && seen[p.activeFile] ? p.activeFile : files[0].name,
      completed: !!p.completed,
      lastRunOk: !!p.lastRunOk,
      ignored: Array.isArray(p.ignored) ? p.ignored.filter(function (k) { return typeof k === 'string'; }).slice(0, 200) : []
    };
  }

  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var s = raw.settings || {};
    d.settings.partnerName = str(s.partnerName, 16, C.PARTNER_NAME).trim() || C.PARTNER_NAME;
    d.settings.aiMode = s.aiMode === 'offline' ? 'offline' : 'auto';
    d.settings.analyzeDelay = num(s.analyzeDelay, C.ANALYZE_DELAY_MIN, C.ANALYZE_DELAY_MAX, C.ANALYZE_DELAY_DEFAULT);
    d.settings.joystick = ['auto', 'on', 'off'].indexOf(s.joystick) >= 0 ? s.joystick : 'auto';
    d.settings.devMode = !!s.devMode;
    d.settings.deepAnalysis = !!s.deepAnalysis;
    var p = raw.progress || {};
    d.progress.xp = num(p.xp, 0, 1e7, 0);
    if (p.achievements && typeof p.achievements === 'object') Object.keys(p.achievements).slice(0, 100).forEach(function (k) { d.progress.achievements[k] = num(p.achievements[k], 0, 9e15, Date.now()); });
    var sk = p.skills || {};
    Object.keys(d.progress.skills).forEach(function (k) { d.progress.skills[k] = num(sk[k], 0, 1e6, 0); });
    var st = p.stats || {};
    ['runs', 'okRuns', 'fixes', 'chats'].forEach(function (k) { d.progress.stats[k] = num(st[k], 0, 1e9, 0); });
    d.progress.stats.roomsVisited = Array.isArray(st.roomsVisited) ? st.roomsVisited.filter(function (r) { return typeof r === 'string'; }).slice(0, 20) : [];
    if (p.missions && typeof p.missions === 'object') Object.keys(p.missions).slice(0, 50).forEach(function (k) {
      var m = p.missions[k] || {};
      d.progress.missions[k] = { done: !!m.done, hints: num(m.hints, 0, 10, 0) };
    });
    d.progress.introSeen = !!p.introSeen;
    d.progress.awarded = Array.isArray(p.awarded) ? p.awarded.filter(function (k) { return typeof k === 'string'; }).slice(-400) : [];
    d.projects = (Array.isArray(raw.projects) ? raw.projects : []).map(sanitizeProject).filter(Boolean).slice(0, C.MAX_PROJECTS);
    d.currentProjectId = typeof raw.currentProjectId === 'string' ? raw.currentProjectId : null;
    var w = raw.world || {};
    d.world = { x: num(w.x, 0, 1400, 700), y: num(w.y, 0, 1000, 560) };
    return d;
  }

  var Store = {
    data: null,
    available: true,
    lastSaveBytes: 0,
    notice: null, // a recoverable message to show after load

    load: function () {
      this.available = canStore();
      var raw = null, recovered = false;
      if (this.available) {
        try { var t = localStorage.getItem(C.SAVE_KEY); if (t) raw = JSON.parse(t); }
        catch (e) {
          console.warn('[CODEMATE] save data is corrupted, trying backup', e);
          try { var b = localStorage.getItem(C.SAVE_KEY + '.bak'); if (b) { raw = JSON.parse(b); recovered = true; } }
          catch (e2) { raw = null; }
          this.notice = recovered ? '저장 데이터가 손상돼서 백업에서 복구했어.' : '저장 데이터를 읽을 수 없어서 새로 시작했어.';
        }
      } else {
        this.notice = '이 브라우저에서는 저장 공간을 쓸 수 없어. 진행 상황이 저장되지 않아.';
      }
      this.data = sanitize(raw);
      if (!this.data.projects.length) this.data.projects.push(this.makeProject('first', 'My First Game'));
      if (!this.project()) this.data.currentProjectId = this.data.projects[0].id;
      return this.data;
    },

    makeProject: function (templateId, name) {
      var t = CM.Content.TEMPLATES[templateId] || CM.Content.TEMPLATES.blank;
      var files = t.files.map(function (f) { return { name: f.name, content: f.content }; });
      var main = files.filter(function (f) { return /\.js$/.test(f.name); })[0] || files[0];
      return { id: CM.util.uid('p'), name: (name || t.name).slice(0, 40), template: templateId, created: Date.now(), updated: Date.now(), files: files, activeFile: main.name, completed: false, lastRunOk: false, ignored: [] };
    },

    project: function () {
      var id = this.data.currentProjectId;
      return this.data.projects.filter(function (p) { return p.id === id; })[0] || null;
    },

    file: function (name) {
      var p = this.project();
      return p ? p.files.filter(function (f) { return f.name === name; })[0] || null : null;
    },

    _timer: null,
    save: function () { // debounced
      var self = this;
      clearTimeout(this._timer);
      this._timer = setTimeout(function () { self.saveNow(); }, 400);
    },
    saveNow: function () {
      clearTimeout(this._timer);
      if (!this.available || this.disabled) return false;
      try {
        var text = JSON.stringify(this.data);
        var prev = localStorage.getItem(C.SAVE_KEY);
        if (prev) { try { JSON.parse(prev); localStorage.setItem(C.SAVE_KEY + '.bak', prev); } catch (e) { /* skip bad backup */ } }
        localStorage.setItem(C.SAVE_KEY, text);
        this.lastSaveBytes = text.length;
        CM.bus.emit('saved', { bytes: text.length });
        return true;
      } catch (e) {
        console.error('[CODEMATE] save failed', e);
        if (CM.UI) CM.UI.toast('저장하지 못했어. 저장 공간이 부족할 수 있어.', 'error');
        return false;
      }
    },
    reset: function () {
      clearTimeout(this._timer);
      this.disabled = true; // nothing may write the old data back before the reload
      try { localStorage.removeItem(C.SAVE_KEY); localStorage.removeItem(C.SAVE_KEY + '.bak'); } catch (e) { /* ignore */ }
    },
    exportProject: function (p) { return JSON.stringify({ codemateProject: 1, project: p }, null, 2); },
    importProject: function (text) {
      var obj = JSON.parse(text);
      var p = sanitizeProject(obj && obj.project ? obj.project : obj);
      if (!p) throw new Error('invalid project file');
      p.id = CM.util.uid('p');
      return p;
    },
    sanitize: sanitize,
    FILE_RE: FILE_RE
  };

  CM.Store = Store;
})(typeof self !== 'undefined' ? self : this);
