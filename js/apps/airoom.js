/* AI Room: the partner up close, progress, achievements, missions and chat. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  var Room = {
    id: 'airoom', title: 'AI Room',
    mount: function (container) {
      var self = this, P = CM.Progress, li = P.levelInfo();
      this.canvas = el('canvas.room-stage', { attrs: { 'aria-label': CM.Partner.name } });
      var stageBox = el('div.room-stage-box', {}, [this.canvas, el('div.room-name', { text: CM.Partner.name }), el('div', { className: 'mode-label ' + (CM.AIService.online ? 'ok' : 'off'), text: CM.AIService.modeLabel })]);
      var bond = el('div.panel', {}, [
        el('h3', { text: 'Partner' }),
        el('p.quote', { text: '"' + CM.Progress.bondLine() + '"' }),
        el('p.muted.small', { text: CM.Partner.name + '의 말과 표정은 게임 속 연출이야. 진행 상황에 따라 대사가 달라져.' }),
        el('button.btn.small', { text: 'TALK', onclick: function () { CM.Partner.say(CM.Progress.bondLine(), { state: 'HAPPY', interrupt: true }); } })
      ]);
      var skills = P.p.skills;
      var stats = el('div.panel', {}, [
        el('h3', { text: 'Level ' + li.level }),
        el('div.xpbar.big', {}, [el('div.xpfill', { style: { width: Math.round(li.pct * 100) + '%' } })]),
        el('p.muted', { text: li.xp + ' XP · next level in ' + (li.need - li.into) + ' XP' }),
        el('div.skills', {}, [['debugging', 'Debugging'], ['syntax', 'Syntax'], ['clean', 'Clean Code'], ['logic', 'Logic']].map(function (s) {
          return el('div.skill', {}, [el('span', { text: s[1] }), el('strong', { text: 'Lv ' + P.skillLevel(skills[s[0]]) })]);
        })),
        el('p.muted.small', { text: 'Runs: ' + P.p.stats.runs + ' · Successful: ' + P.p.stats.okRuns + ' · Fixes: ' + P.p.stats.fixes })
      ]);
      var ach = el('div.panel', {}, [el('h3', { text: 'Achievements' }), el('div.achs', {}, Object.keys(P.ACHIEVEMENTS).map(function (k) {
        var a = P.ACHIEVEMENTS[k], got = !!P.p.achievements[k];
        return el('div.ach' + (got ? '.got' : ''), { title: a.desc }, [el('strong', { text: (got ? '★ ' : '☆ ') + a.name }), el('span', { text: a.desc })]);
      }))]);
      var missions = el('div.panel', {}, [el('h3', { text: 'Missions' })].concat(CM.Content.MISSIONS.map(function (m, i) {
        var done = (P.p.missions[m.id] || {}).done, unlocked = i === 0 || (P.p.missions[CM.Content.MISSIONS[i - 1].id] || {}).done;
        return el('div.mrow', {}, [el('span', { text: (done ? '✓ ' : unlocked ? '○ ' : '🔒 ') + String(i + 1).padStart(2, '0') + ' ' + m.title }),
          el('button.btn.small' + (done ? '' : '.primary'), { text: done ? 'REDO' : 'START', disabled: !unlocked, onclick: function () { CM.Phone.open('codelab', { mission: m.id }); } })]);
      })));
      var chatBox = el('div.panel.chat-panel', {}, [el('h3', { text: 'Chat' })]);
      container.appendChild(el('div.airoom', {}, [stageBox, el('div.room-grid', {}, [bond, stats, missions, ach, chatBox])]));
      this.unsubChat = CM.Chat.mount(chatBox, function () {
        var p = CM.Store.project(), f = CM.Store.file(p.activeFile) || p.files[0];
        var r = CM.Analyzer.analyze(f.content, { fileName: f.name, isMission: true });
        return { code: f.content, file: f.name, files: p.files, issues: r.issues, lastError: CM.CodeLab.m ? CM.CodeLab.m.lastRunError : null, mission: null, declared: r.info.decls || [] };
      }, { onGoto: function (line, file) { CM.Phone.open('codelab', { file: file }); setTimeout(function () { if (CM.CodeLab.m) CM.CodeLab.goto(line, file); }, 50); } });
      this._draw = function (t) { self.draw(t); };
      CM.Stages.add(this._draw);
      CM.Partner.setBase('IDLE');
    },
    unmount: function () { CM.Stages.remove(this._draw); if (this.unsubChat) this.unsubChat(); this.canvas = null; },
    draw: function (t) {
      var c = this.canvas;
      if (!c || !c.offsetParent) return;
      var r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var grd = g.createRadialGradient(r.width / 2, r.height * 0.7, 10, r.width / 2, r.height * 0.7, r.width * 0.6);
      grd.addColorStop(0, '#3a2320'); grd.addColorStop(1, '#0c0f17');
      g.fillStyle = grd; g.fillRect(0, 0, r.width, r.height);
      var sc = Math.min(2.6, r.height / 90);
      CM.Partner.draw(g, r.width / 2, r.height - 18, sc, t, { facing: 1, lookX: Math.sin(t * 0.7) * 1.5, bubble: false });
      if (CM.Partner.bubble) CM.Partner.drawBubble(g, r.width / 2, r.height - 18 - 66 * sc, CM.Partner.bubble.text, 1.1, Math.min(260, r.width * 0.8));
    }
  };

  CM.Phone.register(Room);
})(typeof self !== 'undefined' ? self : this);
