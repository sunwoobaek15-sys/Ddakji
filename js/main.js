/* Boot, main loop, start screen, intro dialog, joystick and HUD wiring. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util, $ = U.$;

  // Canvas "stages" (Code Lab panel, AI Room) drawn by the main loop while visible.
  var stageFns = [];
  CM.Stages = {
    add: function (fn) { if (stageFns.indexOf(fn) < 0) stageFns.push(fn); },
    remove: function (fn) { var i = stageFns.indexOf(fn); if (i >= 0) stageFns.splice(i, 1); }
  };

  var Main = {
    started: false,
    resetting: false,

    boot: function () {
      window.addEventListener('error', function (e) { CM.reportError(e.error || e.message, 'window'); });
      window.addEventListener('unhandledrejection', function (e) { CM.reportError(e.reason, 'promise'); });

      CM.Store.load();
      this.fitViewport();
      CM.Phone.init();
      CM.World.init($('#world'));
      CM.Dev.init();
      this.bindHUD();
      this.bindJoystick();
      this.applyJoystick();
      CM.AIService.init().then(function () { CM.Phone.statusBar(); });

      $('#start-title').textContent = CM.CONFIG.GAME_TITLE;
      $('#start-sub').textContent = CM.CONFIG.SUBTITLE;
      $('#start-btn').addEventListener('click', function () { Main.start(); });
      if (CM.Store.notice) CM.UI.toast(CM.Store.notice, 'warn', 5000);

      var save = function () { if (!Main.resetting) CM.Store.saveNow(); };
      window.addEventListener('pagehide', save);
      document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

      this.loop();
    },

    // Keep the layout equal to the *visible* viewport so the on-screen keyboard never hides the UI.
    fitViewport: function () {
      var set = function () {
        var vv = window.visualViewport, h = vv ? vv.height : window.innerHeight;
        document.documentElement.style.setProperty('--vvh', h + 'px');
        if (vv && vv.offsetTop) window.scrollTo(0, 0);
        if (CM.World.canvas) CM.World.resize();
      };
      var deb = U.debounce(set, 60);
      window.addEventListener('resize', deb);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', deb);
      window.addEventListener('orientationchange', function () { setTimeout(set, 250); });
      set();
    },

    start: function () {
      if (this.started) return;
      this.started = true;
      $('#start-screen').classList.add('hidden');
      $('#world-view').classList.remove('hidden');
      $('#dock').classList.remove('hidden');
      CM.World.resize();
      if (!CM.Store.data.progress.introSeen) this.intro();
      else CM.Partner.say('Welcome back.', { state: 'HAPPY' });
    },

    intro: function () {
      var W = CM.World, p = W.player, a = W.ai;
      a.x = Math.min(W.W - 30, p.x + 260); a.y = p.y; // walks in from the side
      var box = $('#dialog'), text = $('#dialog-text'), btn = $('#dialog-btn');
      var step = 0;
      var lines = ['Hey.', 'Ready to code?'];
      var show = function () {
        text.textContent = lines[step];
        $('#dialog-name').textContent = CM.Partner.name;
        btn.textContent = step < lines.length - 1 ? 'NEXT' : 'YES';
        CM.Partner.say(lines[step], { interrupt: true, ms: 60000 });
      };
      setTimeout(function () { box.classList.remove('hidden'); show(); btn.focus(); }, 1400);
      btn.onclick = function () {
        if (step < lines.length - 1) { step++; show(); return; }
        box.classList.add('hidden');
        btn.onclick = null;
        CM.Store.data.progress.introSeen = true;
        CM.Progress.unlock('first_contact');
        CM.Partner.bubble = null;
        CM.Partner.react('HAPPY', 2500);
        CM.Partner.say('Let\'s start with something simple.', { state: 'HAPPY', interrupt: true });
        CM.Partner.say('Walk into the Code Lab.', {});
        CM.UI.toast(matchMedia('(pointer: coarse)').matches ? 'Move with the joystick or tap the floor. Enter a room and tap OPEN.' : 'Move with WASD / arrow keys (or click). Enter a room and press E.', 'info', 5000);
        CM.Store.save();
      };
    },

    bindHUD: function () {
      var interact = $('#interact'), label = $('#room-label');
      interact.addEventListener('click', function () { CM.World.interact(); });
      var quips = { codelab: 'This is where we code.', terminal: 'Logs live here.', files: 'All our files.', projects: 'Our projects.', airoom: 'My room. Make yourself at home.', settings: 'Settings.' };
      CM.bus.on('room', function (r) {
        label.textContent = r ? r.name : 'Digital World';
        if (r && r.app) { interact.textContent = 'OPEN ' + r.name.toUpperCase(); interact.classList.remove('hidden'); }
        else if (r && r.id === 'home') { interact.textContent = 'TALK'; interact.classList.remove('hidden'); }
        else interact.classList.add('hidden');
        if (r && r.app) {
          var first = CM.Store.data.progress.stats.roomsVisited.indexOf(r.id) < 0;
          CM.Progress.visitRoom(r.id, CM.World.ROOMS.length + 1);
          if (first || Math.random() < 0.25) CM.Partner.say(quips[r.id] || r.name, {});
        } else if (r && r.id === 'home') CM.Progress.visitRoom('home', CM.World.ROOMS.length + 1);
      });
      CM.bus.on('xp', function (e) { CM.UI.toast('+' + e.amount + ' XP · ' + e.reason, 'xp', 2200); });
      CM.bus.on('levelup', function (e) { CM.UI.toast('LEVEL UP! Lv ' + e.level, 'ok', 3500); CM.Partner.say(CM.Progress.bondLine(), { state: 'HAPPY' }); });
      CM.bus.on('achievement', function (e) { CM.UI.toast('★ Achievement: ' + e.info.name, 'ach', 3500); });
    },

    bindJoystick: function () {
      var base = $('#joystick'), knob = $('#joystick .knob'), id = null, R = 46;
      var move = function (e) {
        var r = base.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy);
        if (d > R) { dx = dx / d * R; dy = dy / d * R; }
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        var mag = Math.min(1, d / R);
        CM.World.setJoystick(mag < 0.15 ? 0 : dx / R, mag < 0.15 ? 0 : dy / R, true);
      };
      var end = function () { id = null; knob.style.transform = ''; CM.World.setJoystick(0, 0, false); };
      base.addEventListener('pointerdown', function (e) { id = e.pointerId; base.setPointerCapture(id); move(e); e.preventDefault(); });
      base.addEventListener('pointermove', function (e) { if (e.pointerId === id) move(e); });
      base.addEventListener('pointerup', end);
      base.addEventListener('pointercancel', end);
      base.addEventListener('lostpointercapture', end);
    },

    applyJoystick: function () {
      var mode = CM.Store.data.settings.joystick;
      var show = mode === 'on' || (mode === 'auto' && window.matchMedia('(pointer: coarse)').matches);
      $('#joystick').classList.toggle('hidden', !show);
      $('#world-view').classList.toggle('touch', show);
    },

    loop: function () {
      var last = performance.now(), frames = 0, fpsT = last;
      var frame = function (now) {
        var dt = Math.min(0.05, (now - last) / 1000); last = now;
        var t = now / 1000;
        try {
          CM.Partner.update();
          if (Main.started && !CM.Phone.current) { CM.World.update(dt); CM.World.render(t); }
          for (var i = 0; i < stageFns.length; i++) stageFns[i](t);
        } catch (e) { CM.reportError(e, 'frame'); }
        frames++;
        if (now - fpsT >= 1000) { CM.Dev.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
  };

  CM.Main = Main;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { Main.boot(); });
  else Main.boot();
})(typeof self !== 'undefined' ? self : this);
