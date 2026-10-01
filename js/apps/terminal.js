/* Terminal app: run output history plus a few real commands. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  var lines = []; // shared output log (also fed by Code Lab runs)

  var Terminal = {
    id: 'terminal', title: 'Terminal',
    record: function (level, text) {
      lines.push({ level: level, text: String(text) });
      if (lines.length > 500) lines.splice(0, lines.length - 500);
      if (this.out) this._append(lines[lines.length - 1]);
    },
    mount: function (container) {
      var self = this;
      this.out = el('div.term-out', { attrs: { role: 'log' } });
      var input = el('input.term-input', { attrs: { 'aria-label': 'Command', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'help' } });
      var hist = [], hi = 0;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { var v = input.value.trim(); input.value = ''; if (v) { hist.push(v); hi = hist.length; self.exec(v); } }
        else if (e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi - 1); input.value = hist[hi]; e.preventDefault(); }
        else if (e.key === 'ArrowDown' && hist.length) { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; e.preventDefault(); }
      });
      var quick = el('div.chat-chips', {}, ['help', 'ls', 'run', 'status', 'missions', 'clear'].map(function (c) { return el('button.chip', { text: c, onclick: function () { self.exec(c); } }); }));
      container.appendChild(el('div.terminal', {}, [this.out, quick, el('div.term-line', {}, [el('span.prompt', { text: '$' }), input])]));
      if (!lines.length) this.record('info', 'CODEMATE terminal. Type "help".');
      lines.forEach(function (l) { self._append(l); });
      setTimeout(function () { if (window.matchMedia('(pointer: fine)').matches) input.focus(); }, 50);
    },
    unmount: function () { this.out = null; },
    _append: function (l) {
      this.out.appendChild(el('div.cl.' + l.level, { text: l.text }));
      while (this.out.children.length > 500) this.out.removeChild(this.out.firstChild);
      this.out.scrollTop = this.out.scrollHeight;
    },
    exec: function (cmdline) {
      var self = this, parts = cmdline.split(/\s+/), cmd = parts[0].toLowerCase(), arg = parts.slice(1).join(' ');
      var p = CM.Store.project(), say = function (t, lv) { self.record(lv || 'log', t); };
      this.record('info', '$ ' + cmdline);
      switch (cmd) {
        case 'help':
          say('help · ls · cat <file> · open <file> · run · analyze <file> · status · xp · missions · projects · whoami · date · echo <text> · clear'); break;
        case 'ls': p.files.forEach(function (f) { say(f.name.padEnd(16) + f.content.length + ' chars'); }); break;
        case 'cat': {
          var f = p.files.filter(function (x) { return x.name === arg; })[0];
          if (!f) say('cat: ' + (arg || '?') + ': no such file', 'error');
          else f.content.split('\n').forEach(function (l, i) { say(String(i + 1).padStart(3) + '  ' + l); });
          break;
        }
        case 'open':
          if (p.files.some(function (x) { return x.name === arg; })) CM.Phone.open('codelab', { file: arg });
          else say('open: ' + (arg || '?') + ': no such file', 'error');
          break;
        case 'run': CM.Phone.open('codelab', { run: true, view: 'run' }); break;
        case 'analyze': {
          var g = p.files.filter(function (x) { return x.name === (arg || p.activeFile); })[0];
          if (!g) { say('analyze: no such file', 'error'); break; }
          var r = CM.Analyzer.analyze(g.content, { fileName: g.name, isMission: true });
          say(g.name + ': ' + r.issues.length + ' issue(s) in ' + r.ms + 'ms');
          r.issues.forEach(function (i) { say('  line ' + i.line + ' [' + i.type + '] ' + i.message, i.severity === 'error' ? 'error' : 'warn'); });
          break;
        }
        case 'status': say(CM.AIService.modeLabel + ' · backend: ' + CM.AIService.status + (CM.AIService.model ? ' · model: ' + CM.AIService.model : '')); break;
        case 'xp': { var li = CM.Progress.levelInfo(); say('Level ' + li.level + ' · ' + li.xp + ' XP total · ' + li.into + '/' + li.need + ' to next level'); break; }
        case 'missions': CM.Content.MISSIONS.forEach(function (m, i) { say((CM.Progress.p.missions[m.id] && CM.Progress.p.missions[m.id].done ? '[x] ' : '[ ] ') + 'MISSION ' + String(i + 1).padStart(2, '0') + ' ' + m.title); }); break;
        case 'projects': CM.Store.data.projects.forEach(function (x) { say((x.id === CM.Store.data.currentProjectId ? '* ' : '  ') + x.name + (x.completed ? ' (complete)' : '')); }); break;
        case 'whoami': say('player · partner: ' + CM.Partner.name); break;
        case 'date': say(new Date().toString()); break;
        case 'echo': say(arg); break;
        case 'clear': lines.length = 0; if (this.out) this.out.innerHTML = ''; break;
        default: say(cmd + ': command not found. Try "help".', 'error');
      }
    }
  };

  CM.Terminal = Terminal;
  CM.Phone.register(Terminal);
})(typeof self !== 'undefined' ? self : this);
