/* Phone OS shell: app registry, open/close/back navigation, dock and status bar. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util;

  var APP_ROOM = { codelab: 'codelab', files: 'files', projects: 'projects', terminal: 'terminal', airoom: 'airoom', settings: 'settings' };

  var Phone = {
    apps: {},
    current: null, // id of the visible app (null = Home world)
    stack: [],
    _historyDepth: 0,

    register: function (app) { this.apps[app.id] = app; },

    open: function (id, params) {
      var app = this.apps[id];
      if (!app) return;
      params = params || {};
      try {
        if (this.current === id) { if (app.update) app.update(params); return; }
        if (this.current) { this._unmount(this.current); this.stack.push(this.current); }
        else if (!params.fromWorld && APP_ROOM[id]) CM.World.warpTo(APP_ROOM[id]); // walk-in shortcut from the dock
        this.current = id;
        var layer = U.$('#app-layer'), body = U.$('#app-body');
        body.innerHTML = '';
        body.className = 'app-body app-' + id;
        U.$('#app-title').textContent = app.title;
        layer.classList.remove('hidden');
        layer.setAttribute('data-app', id);
        U.$('#world-view').classList.add('behind');
        CM.World.paused = true;
        app.mount(body, params);
        if (APP_ROOM[id]) CM.Progress.visitRoom(APP_ROOM[id], CM.World.ROOMS.length + 1);
        this._dock();
        try { history.pushState({ cmApp: id }, ''); this._historyDepth++; } catch (e) { /* ignore */ }
        CM.bus.emit('app:open', id);
      } catch (e) {
        CM.reportError(e, 'open ' + id);
        this.home();
      }
    },

    _unmount: function (id) {
      var app = this.apps[id];
      try { if (app && app.unmount) app.unmount(); } catch (e) { CM.reportError(e, 'unmount ' + id); }
    },

    // Back: let the app handle it first (e.g. close a sub view), then go to the previous app or Home.
    back: function (fromPop) {
      if (!this.current) return;
      var app = this.apps[this.current];
      if (app && app.onBack && app.onBack()) { if (fromPop) { try { history.pushState({ cmApp: this.current }, ''); } catch (e) { /* ignore */ } } return; }
      var prev = this.stack.pop();
      this._unmount(this.current);
      this.current = null;
      if (!fromPop && this._historyDepth > 0) { this._historyDepth--; this._skipPop = true; try { history.back(); } catch (e) { /* ignore */ } }
      else if (fromPop && this._historyDepth > 0) this._historyDepth--;
      if (prev) { this._reopen(prev); }
      else this._showHome();
    },

    _reopen: function (id) {
      var app = this.apps[id];
      this.current = id;
      var body = U.$('#app-body');
      body.innerHTML = '';
      body.className = 'app-body app-' + id;
      U.$('#app-title').textContent = app.title;
      U.$('#app-layer').setAttribute('data-app', id);
      app.mount(body, {});
      this._dock();
    },

    home: function () {
      if (this.current) this._unmount(this.current);
      this.current = null;
      this.stack = [];
      if (this._historyDepth > 0) { this._skipPop = true; try { history.go(-this._historyDepth); } catch (e) { /* ignore */ } this._historyDepth = 0; }
      this._showHome();
    },

    _showHome: function () {
      U.$('#app-layer').classList.add('hidden');
      U.$('#app-body').innerHTML = '';
      U.$('#world-view').classList.remove('behind');
      CM.World.paused = false;
      CM.World.resize();
      this._dock();
      CM.bus.emit('app:close');
    },

    _dock: function () {
      var cur = this.current || 'home';
      U.$all('#dock [data-app]').forEach(function (b) {
        var on = b.getAttribute('data-app') === cur;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    },

    init: function () {
      var self = this;
      U.$all('#dock [data-app]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-app');
          if (id === 'home') self.home(); else self.open(id);
        });
      });
      U.$('#app-back').addEventListener('click', function () { self.back(false); });
      U.$('#app-home').addEventListener('click', function () { self.home(); });
      window.addEventListener('popstate', function () {
        if (self._skipPop) { self._skipPop = false; return; }
        if (self.current) self.back(true);
      });
      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.current && !CM.UI.modalOpen() && !(e.target && e.target.tagName === 'TEXTAREA')) self.back(false);
      });
      this._clock();
      setInterval(function () { self._clock(); }, 15000);
      CM.bus.on('ai:status', function () { self.statusBar(); });
      CM.bus.on('xp', function () { self.statusBar(); });
      this.statusBar();
    },

    _clock: function () {
      var d = new Date(), t = U.$('#sb-time');
      if (t) t.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },

    statusBar: function () {
      var s = CM.AIService.status, pill = U.$('#sb-ai');
      if (pill) {
        pill.textContent = CM.AIService.online ? 'AI ONLINE' : 'OFFLINE';
        pill.className = 'pill ' + (CM.AIService.online ? 'ok' : 'off');
        pill.title = CM.AIService.modeLabel + (s === 'unavailable' && CM.AIService.lastError ? ' — ' + CM.AIService.lastError : '');
      }
      var li = CM.Progress.levelInfo(), lv = U.$('#sb-level');
      if (lv) lv.textContent = 'Lv ' + li.level;
      var bar = U.$('#xp-fill'); if (bar) bar.style.width = Math.round(li.pct * 100) + '%';
      var xpt = U.$('#xp-text'); if (xpt) xpt.textContent = 'Lv ' + li.level + ' · ' + li.into + '/' + li.need + ' XP';
    }
  };

  CM.Phone = Phone;
})(typeof self !== 'undefined' ? self : this);
