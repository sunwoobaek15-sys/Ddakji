/* XP, levels, skills, achievements and the partner "bond" lines. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  var ACHIEVEMENTS = {
    first_contact: { name: 'First Contact', desc: '코딩 파트너를 만났다' },
    lab_rat: { name: 'Lab Rat', desc: 'Code Lab에 처음 들어갔다' },
    explorer: { name: 'Explorer', desc: '모든 방을 둘러봤다' },
    it_runs: { name: 'It Runs!', desc: '처음으로 코드를 성공적으로 실행했다' },
    typo_hunter: { name: 'Typo Hunter', desc: '오타를 고쳤다' },
    syntax_slayer: { name: 'Syntax Slayer', desc: '문법 오류를 해결했다' },
    clean_coder: { name: 'Clean Coder', desc: '쓰지 않는 코드를 정리했다' },
    refactorer: { name: 'Refactorer', desc: '반복 코드를 개선했다' },
    debugger: { name: 'Debugger', desc: '실행 오류를 고치고 다시 성공했다' },
    first_mission: { name: 'Mission Start', desc: '첫 미션을 완료했다' },
    all_missions: { name: 'Mission Master', desc: '모든 미션을 완료했다' },
    builder: { name: 'We Built This', desc: '프로젝트를 완성했다' },
    chatter: { name: 'Pair Programmer', desc: '파트너와 5번 대화했다' },
    level_5: { name: 'Level 5', desc: '레벨 5에 도달했다' }
  };

  function xpForLevel(level) { return 50 * level * (level - 1); } // L1:0 L2:100 L3:300 L4:600 L5:1000
  function levelFor(xp) { var l = 1; while (xpForLevel(l + 1) <= xp) l++; return l; }

  var Progress = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    get p() { return CM.Store.data.progress; },
    level: function () { return levelFor(this.p.xp); },
    levelInfo: function () {
      var lv = this.level(), base = xpForLevel(lv), next = xpForLevel(lv + 1);
      return { level: lv, xp: this.p.xp, into: this.p.xp - base, need: next - base, pct: (this.p.xp - base) / (next - base) };
    },
    // `onceKey` prevents the same fix from being farmed for XP.
    addXP: function (amount, reason, onceKey) {
      if (onceKey) {
        if (this.p.awarded.indexOf(onceKey) >= 0) return false;
        this.p.awarded.push(onceKey);
        if (this.p.awarded.length > 400) this.p.awarded.splice(0, this.p.awarded.length - 400);
      }
      var before = this.level();
      this.p.xp += amount;
      var after = this.level();
      CM.bus.emit('xp', { amount: amount, reason: reason, level: after });
      if (after > before) {
        CM.bus.emit('levelup', { level: after });
        if (after >= 5) this.unlock('level_5');
      }
      CM.Store.save();
      return true;
    },
    skill: function (name, n) { this.p.skills[name] = (this.p.skills[name] || 0) + (n || 1); CM.Store.save(); },
    unlock: function (id) {
      if (!ACHIEVEMENTS[id] || this.p.achievements[id]) return false;
      this.p.achievements[id] = Date.now();
      CM.bus.emit('achievement', { id: id, info: ACHIEVEMENTS[id] });
      CM.Store.save();
      return true;
    },
    visitRoom: function (id, total) {
      var v = this.p.stats.roomsVisited;
      if (v.indexOf(id) < 0) { v.push(id); CM.Store.save(); }
      if (v.length >= total) this.unlock('explorer');
    },
    missionsDone: function () {
      var m = this.p.missions;
      return Object.keys(m).filter(function (k) { return m[k].done; }).length;
    },
    // Relationship stage drives how the partner talks (pure game direction, not real feelings).
    bondStage: function () {
      var lv = this.level(), md = this.missionsDone();
      if (lv >= 5 || md >= 5) return 2;
      if (lv >= 3 || md >= 2) return 1;
      return 0;
    },
    bondLine: function () {
      var built = CM.Store.data.projects.some(function (p) { return p.completed; });
      if (built && Math.random() < 0.5) return 'We actually built this.';
      return ['Let\'s start with something simple.', 'You\'re getting faster.', 'You don\'t need me to explain that anymore.'][this.bondStage()];
    },
    skillLevel: function (v) { return Math.floor(Math.sqrt(v)) + 1; }
  };

  CM.Progress = Progress;
})(typeof self !== 'undefined' ? self : this);
