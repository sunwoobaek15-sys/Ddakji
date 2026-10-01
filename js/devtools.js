/* DEV MODE overlay (F1 or Settings). */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  var Dev = {
    on: false, analysisMs: 0, fps: 0, _timer: null, box: null,
    init: function () {
      var self = this;
      window.addEventListener('keydown', function (e) {
        if (e.key === 'F1') { e.preventDefault(); self.toggle(!self.on); CM.Store.data.settings.devMode = self.on; CM.Store.save(); }
      });
      this.toggle(CM.Store.data.settings.devMode);
    },
    toggle: function (on) {
      var self = this;
      this.on = !!on;
      var host = document.getElementById('dev-overlay');
      host.hidden = !this.on;
      clearInterval(this._timer);
      if (!this.on) return;
      host.innerHTML = '';
      this.box = el('pre.dev-data');
      host.appendChild(el('div.dev-h', {}, [el('strong', { text: 'DEV MODE' }),
        el('button.btn.small', { text: 'SAVE → CONSOLE', onclick: function () { console.log('[CODEMATE save]', JSON.parse(JSON.stringify(CM.Store.data))); CM.UI.toast('Save data printed to the console.', 'info'); } }),
        el('button.btn.small', { text: '×', attrs: { 'aria-label': 'Close dev mode' }, onclick: function () { self.toggle(false); CM.Store.data.settings.devMode = false; CM.Store.save(); } })]));
      host.appendChild(this.box);
      this._timer = setInterval(function () { self.render(); }, 250);
      this.render();
    },
    render: function () {
      if (!this.box) return;
      var W = CM.World, P = CM.Partner, lab = CM.CodeLab && CM.CodeLab.m, saveBytes = 0;
      try { saveBytes = JSON.stringify(CM.Store.data).length; } catch (e) { /* ignore */ }
      var rows = [
        ['FPS', this.fps],
        ['AI state', P.state + ' (base ' + P.base + ')'],
        ['Speech', P.bubble ? '"' + P.bubble.text.slice(0, 40) + '"' : '-'],
        ['Analysis', this.analysisMs + ' ms' + (lab && lab.analysis ? ' · ' + lab.analysis.issues.length + ' issues · ' + lab.analysis.summary : '')],
        ['File', lab && lab.file ? lab.file.name : (CM.Store.project() || {}).activeFile],
        ['App', CM.Phone.current || 'home (world)'],
        ['Player', Math.round(W.player.x) + ', ' + Math.round(W.player.y) + (W.room ? ' · ' + W.room.name : '')],
        ['Partner', Math.round(W.ai.x) + ', ' + Math.round(W.ai.y) + ' · dist ' + Math.round(Math.hypot(W.player.x - W.ai.x, W.player.y - W.ai.y))],
        ['API', CM.AIService.status + (CM.AIService.model ? ' · ' + CM.AIService.model : '') + (CM.AIService.lastError ? ' · ' + CM.AIService.lastError : '')],
        ['Mode', CM.AIService.modeLabel],
        ['Save', (saveBytes / 1024).toFixed(1) + ' KB · ' + CM.Store.data.projects.length + ' projects · XP ' + CM.Store.data.progress.xp]
      ];
      this.box.textContent = rows.map(function (r) { return (r[0] + ':').padEnd(10) + ' ' + r[1]; }).join('\n');
    }
  };

  CM.Dev = Dev;
})(typeof self !== 'undefined' ? self : this);
