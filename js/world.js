/* The explorable "inside the phone" world: rooms, movement, collision and the follow AI. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util;

  var W = 1400, H = 1000, WALL = 14, DOOR = 120;
  var ROOMS = [
    { id: 'codelab', name: 'Code Lab', app: 'codelab', x: 80, y: 80, w: 500, h: 340, door: 'bottom', accent: '#6cc4ff', floor: '#14213a', icon: '</>' },
    { id: 'settings', name: 'Settings', app: 'settings', x: 620, y: 80, w: 160, h: 220, door: 'bottom', accent: '#a0aec0', floor: '#1d2230', icon: '⚙' },
    { id: 'airoom', name: 'AI Room', app: 'airoom', x: 820, y: 80, w: 500, h: 340, door: 'bottom', accent: '#e8886a', floor: '#2a1c1c', icon: '✦' },
    { id: 'files', name: 'Files', app: 'files', x: 80, y: 620, w: 320, h: 300, door: 'top', accent: '#ffd166', floor: '#2a2516', icon: '▤' },
    { id: 'projects', name: 'Projects', app: 'projects', x: 540, y: 640, w: 320, h: 280, door: 'top', accent: '#7ee0b5', floor: '#16291f', icon: '◆' },
    { id: 'terminal', name: 'Terminal', app: 'terminal', x: 1000, y: 620, w: 320, h: 300, door: 'top', accent: '#68d391', floor: '#0e1a12', icon: '>_' }
  ];
  var HOME = { id: 'home', name: 'Home', x: 560, y: 450, w: 280, h: 140 };

  var walls = [], props = [];
  function buildMap() {
    walls = [
      { x: -40, y: -40, w: W + 80, h: 40 + WALL }, { x: -40, y: H - WALL, w: W + 80, h: 40 + WALL },
      { x: -40, y: -40, w: 40 + WALL, h: H + 80 }, { x: W - WALL, y: -40, w: 40 + WALL, h: H + 80 }
    ];
    ROOMS.forEach(function (r) {
      var gap = Math.min(DOOR, r.w - 40), gx = r.x + (r.w - gap) / 2;
      var top = r.door === 'top', bottom = r.door === 'bottom';
      if (top) { walls.push({ x: r.x, y: r.y, w: gx - r.x, h: WALL }, { x: gx + gap, y: r.y, w: r.x + r.w - gx - gap, h: WALL }); }
      else walls.push({ x: r.x, y: r.y, w: r.w, h: WALL });
      if (bottom) { walls.push({ x: r.x, y: r.y + r.h - WALL, w: gx - r.x, h: WALL }, { x: gx + gap, y: r.y + r.h - WALL, w: r.x + r.w - gx - gap, h: WALL }); }
      else walls.push({ x: r.x, y: r.y + r.h - WALL, w: r.w, h: WALL });
      walls.push({ x: r.x, y: r.y, w: WALL, h: r.h }, { x: r.x + r.w - WALL, y: r.y, w: WALL, h: r.h });
      r.doorX = gx + gap / 2; r.doorY = top ? r.y : r.y + r.h;
    });
    // furniture (solid)
    props = [
      { room: 'codelab', kind: 'desk', x: 200, y: 150, w: 260, h: 46 },
      { room: 'codelab', kind: 'server', x: 110, y: 110, w: 40, h: 90 },
      { room: 'airoom', kind: 'sofa', x: 1000, y: 140, w: 150, h: 44 },
      { room: 'airoom', kind: 'core', x: 1215, y: 140, w: 60, h: 60 },
      { room: 'files', kind: 'cabinet', x: 110, y: 820, w: 60, h: 70 }, { room: 'files', kind: 'cabinet', x: 310, y: 820, w: 60, h: 70 },
      { room: 'projects', kind: 'table', x: 640, y: 800, w: 120, h: 60 },
      { room: 'terminal', kind: 'rack', x: 1040, y: 820, w: 50, h: 80 }, { room: 'terminal', kind: 'rack', x: 1230, y: 820, w: 50, h: 80 },
      { room: 'settings', kind: 'gear', x: 675, y: 120, w: 50, h: 50 }
    ];
    walls = walls.concat(props);
  }
  buildMap();

  // ---------- geometry ----------
  function collide(e) {
    for (var i = 0; i < walls.length; i++) {
      var r = walls[i];
      var nx = U.clamp(e.x, r.x, r.x + r.w), ny = U.clamp(e.y, r.y, r.y + r.h);
      var dx = e.x - nx, dy = e.y - ny, d2 = dx * dx + dy * dy;
      if (d2 < e.r * e.r) {
        if (d2 > 1e-6) { var d = Math.sqrt(d2), push = e.r - d; e.x += dx / d * push; e.y += dy / d * push; }
        else { // center inside: push out the shortest way
          var l = e.x - r.x, rr = r.x + r.w - e.x, t = e.y - r.y, b = r.y + r.h - e.y, m = Math.min(l, rr, t, b);
          if (m === l) e.x = r.x - e.r; else if (m === rr) e.x = r.x + r.w + e.r; else if (m === t) e.y = r.y - e.r; else e.y = r.y + r.h + e.r;
        }
      }
    }
    e.x = U.clamp(e.x, e.r, W - e.r); e.y = U.clamp(e.y, e.r, H - e.r);
  }
  function segHitsRect(x1, y1, x2, y2, r, pad) { // Liang-Barsky
    var minX = r.x - pad, maxX = r.x + r.w + pad, minY = r.y - pad, maxY = r.y + r.h + pad;
    var dx = x2 - x1, dy = y2 - y1, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
    }
    return true;
  }
  function lineOfSight(x1, y1, x2, y2, pad) {
    for (var i = 0; i < walls.length; i++) if (segHitsRect(x1, y1, x2, y2, walls[i], pad)) return false;
    return true;
  }
  function roomAt(x, y) {
    for (var i = 0; i < ROOMS.length; i++) { var r = ROOMS[i]; if (x > r.x + WALL && x < r.x + r.w - WALL && y > r.y + WALL && y < r.y + r.h - WALL) return r; }
    if (x > HOME.x && x < HOME.x + HOME.w && y > HOME.y && y < HOME.y + HOME.h) return HOME;
    return null;
  }

  // ---------- state ----------
  var World = {
    W: W, H: H, ROOMS: ROOMS, HOME: HOME,
    canvas: null, ctx: null, dpr: 1, zoom: 1, vw: 0, vh: 0, cam: { x: 0, y: 0 },
    player: { x: 700, y: 560, vx: 0, vy: 0, r: 13, fx: 1, fy: 0, moving: false },
    ai: { x: 640, y: 560, vx: 0, vy: 0, r: 12, facing: 1, idleFor: 0, stuckFor: 0, poof: 0 },
    crumbs: [],
    keys: {},
    joy: { x: 0, y: 0, active: false },
    tapTarget: null,
    room: null,
    paused: false,
    staticLayer: null,
    fps: 0,

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      var w = CM.Store.data.world;
      this.player.x = w.x; this.player.y = w.y; collide(this.player);
      this.ai.x = this.player.x - 50; this.ai.y = this.player.y + 10; collide(this.ai);
      this._bindInput();
      this.resize();
    },

    resize: function () {
      var rect = this.canvas.getBoundingClientRect();
      this.vw = Math.max(1, rect.width); this.vh = Math.max(1, rect.height);
      this.dpr = Math.min(2, root.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.vw * this.dpr); this.canvas.height = Math.round(this.vh * this.dpr);
      this.zoom = U.clamp(Math.min(this.vw / 560, this.vh / 470), 0.55, 1.4);
      var res = Math.min(2, this.dpr * this.zoom);
      if (!this.staticLayer || Math.abs(this.staticLayer.res - res) > 0.2) this._buildStatic(res);
    },

    _bindInput: function () {
      var self = this;
      var typing = function (e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
      window.addEventListener('keydown', function (e) {
        if (typing(e) || CM.Phone.current) return;
        var k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].indexOf(k) >= 0) { self.keys[k] = true; self.tapTarget = null; e.preventDefault(); }
        if ((k === 'e' || k === 'enter' || k === ' ') && !e.repeat && !CM.UI.modalOpen()) { e.preventDefault(); self.interact(); }
      });
      window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
      window.addEventListener('blur', function () { self.keys = {}; });
      this.canvas.addEventListener('pointerdown', function (e) {
        if (CM.Phone.current) return;
        var r = self.canvas.getBoundingClientRect();
        var wx = (e.clientX - r.left) / self.zoom + self.cam.x, wy = (e.clientY - r.top) / self.zoom + self.cam.y;
        self.tapTarget = { x: U.clamp(wx, 20, W - 20), y: U.clamp(wy, 20, H - 20), t: performance.now() };
      });
    },

    setJoystick: function (x, y, active) { this.joy.x = x; this.joy.y = y; this.joy.active = active; if (active) this.tapTarget = null; },

    interact: function () {
      var r = this.room;
      if (r && r.app) { CM.Phone.open(r.app, { fromWorld: true }); return; }
      if (r && r.id === 'home') {
        CM.Partner.say(CM.Progress.bondLine(), { state: 'HAPPY', interrupt: true });
        return;
      }
      CM.Partner.say('Walk into a room, then tap OPEN.', { interrupt: true });
    },

    // Places player + partner inside a room (used when an app is opened from the dock).
    warpTo: function (roomId) {
      var r = ROOMS.filter(function (x) { return x.id === roomId; })[0];
      if (!r) return;
      var p = this.player, a = this.ai;
      p.x = r.x + r.w / 2; p.y = r.door === 'bottom' ? r.y + r.h - 60 : r.y + 60; collide(p);
      a.x = p.x - 45; a.y = p.y + 6; a.vx = a.vy = 0; collide(a);
      this.crumbs.length = 0; this.tapTarget = null;
      this._checkRoom();
    },

    update: function (dt) {
      if (this.paused) return;
      var p = this.player, ix = 0, iy = 0, k = this.keys;
      if (k.arrowleft || k.a) ix -= 1; if (k.arrowright || k.d) ix += 1;
      if (k.arrowup || k.w) iy -= 1; if (k.arrowdown || k.s) iy += 1;
      if (this.joy.active) { ix += this.joy.x; iy += this.joy.y; }
      if (!ix && !iy && this.tapTarget) {
        var tx = this.tapTarget.x - p.x, ty = this.tapTarget.y - p.y, td = Math.hypot(tx, ty);
        if (td < 8 || performance.now() - this.tapTarget.t > 6000) this.tapTarget = null;
        else { ix = tx / td; iy = ty / td; if (td < 40) { ix *= td / 40; iy *= td / 40; } }
      }
      var mag = Math.hypot(ix, iy);
      if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
      var speed = CM.CONFIG.PLAYER_SPEED;
      var ax = ix * speed, ay = iy * speed, smooth = 1 - Math.pow(0.0001, dt);
      p.vx = U.lerp(p.vx, ax, smooth); p.vy = U.lerp(p.vy, ay, smooth);
      var ox = p.x, oy = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      collide(p);
      var moved = Math.hypot(p.x - ox, p.y - oy);
      p.moving = moved > 0.3;
      if (mag > 0.15) { p.fx = ix / mag; p.fy = iy / mag; }
      if (this.tapTarget && moved < 0.05 && mag > 0.5) this.tapTarget = null; // blocked by a wall
      // breadcrumbs for the partner to follow around corners
      var last = this.crumbs[this.crumbs.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 22) { this.crumbs.push({ x: p.x, y: p.y }); if (this.crumbs.length > 80) this.crumbs.shift(); }

      this._updateAI(dt);
      this._checkRoom();
      this._updateCamera();
      CM.Store.data.world.x = Math.round(p.x); CM.Store.data.world.y = Math.round(p.y);
    },

    _updateAI: function (dt) {
      var p = this.player, a = this.ai;
      // Desired spot: a little behind and beside the player, based on the player's facing.
      var tx = p.x - p.fx * 46 - p.fy * 18, ty = p.y - p.fy * 46 + p.fx * 18;
      var target = { x: tx, y: ty };
      if (!lineOfSight(a.x, a.y, tx, ty, a.r - 2)) {
        // follow the newest breadcrumb we can see
        target = null;
        for (var i = this.crumbs.length - 1; i >= 0; i--) {
          var c = this.crumbs[i];
          if (lineOfSight(a.x, a.y, c.x, c.y, a.r - 2)) { target = c; this.crumbs.splice(0, i); break; }
        }
        if (!target) target = this.crumbs[0] || { x: tx, y: ty };
      }
      var dx = target.x - a.x, dy = target.y - a.y, d = Math.hypot(dx, dy);
      var distP = Math.hypot(p.x - a.x, p.y - a.y);
      // Speed scales with distance: catch up when far, slow down when close.
      var maxSpeed = CM.CONFIG.PLAYER_SPEED * (distP > 260 ? 1.55 : distP > 140 ? 1.2 : 0.95);
      var desired = d < 6 ? 0 : Math.min(maxSpeed, d * 3.2);
      if (distP < 34) desired *= 0.3;
      var vx = d > 0 ? dx / d * desired : 0, vy = d > 0 ? dy / d * desired : 0;
      var sm = 1 - Math.pow(0.002, dt);
      a.vx = U.lerp(a.vx, vx, sm); a.vy = U.lerp(a.vy, vy, sm);
      // keep personal space
      if (distP < 30 && distP > 0.01) { a.vx -= (p.x - a.x) / distP * 60; a.vy -= (p.y - a.y) / distP * 60; }
      a.x += a.vx * dt; a.y += a.vy * dt;
      collide(a);
      var sp = Math.hypot(a.vx, a.vy);
      if (sp > 12) { a.facing = a.vx >= 0 ? 1 : -1; a.idleFor = 0; }
      else { a.idleFor += dt; if (Math.abs(p.x - a.x) > 4) a.facing = p.x >= a.x ? 1 : -1; }
      // Base state from movement (reaction states override temporarily).
      var base = sp > 12 ? (distP > 120 ? 'FOLLOW' : 'WALK') : (a.idleFor > 4 ? 'CODING' : 'IDLE');
      if (CM.Partner.base !== base) CM.Partner.setBase(base);
      // Safety net: if somehow stuck far away for a while, hop next to the player with a little "poof".
      if (distP > 420 && sp < 30) a.stuckFor += dt; else a.stuckFor = 0;
      if (a.stuckFor > 3) { a.x = p.x - p.fx * 40; a.y = p.y - p.fy * 40; collide(a); a.stuckFor = 0; a.poof = 1; this.crumbs.length = 0; }
      if (a.poof > 0) a.poof = Math.max(0, a.poof - dt * 2);
    },

    _checkRoom: function () {
      var r = roomAt(this.player.x, this.player.y);
      if (r !== this.room) {
        this.room = r;
        CM.bus.emit('room', r);
      }
    },

    _updateCamera: function () {
      var vw = this.vw / this.zoom, vh = this.vh / this.zoom, p = this.player;
      var cx = vw >= W ? (W - vw) / 2 : U.clamp(p.x - vw / 2, 0, W - vw);
      var cy = vh >= H ? (H - vh) / 2 : U.clamp(p.y - vh / 2, 0, H - vh);
      this.cam.x = U.lerp(this.cam.x, cx, 0.18); this.cam.y = U.lerp(this.cam.y, cy, 0.18);
      if (!this._camInit) { this.cam.x = cx; this.cam.y = cy; this._camInit = true; }
    },

    // ---------- rendering ----------
    _buildStatic: function (res) {
      var c = document.createElement('canvas');
      c.width = Math.round(W * res); c.height = Math.round(H * res); c.res = res;
      var g = c.getContext('2d');
      g.scale(res, res);
      // floor
      g.fillStyle = '#0b0f19'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(108,196,255,0.06)'; g.lineWidth = 1;
      for (var x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (var y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      // circuit paths from home to each door
      g.strokeStyle = 'rgba(217,119,87,0.22)'; g.lineWidth = 6; g.lineCap = 'round';
      ROOMS.forEach(function (r) {
        g.beginPath(); g.moveTo(700, 520); g.lineTo(r.doorX, 520); g.lineTo(r.doorX, r.doorY); g.stroke();
      });
      // home pad
      g.fillStyle = 'rgba(217,119,87,0.10)'; CM.Partner.roundRect(g, HOME.x, HOME.y, HOME.w, HOME.h, 26); g.fill();
      g.strokeStyle = 'rgba(217,119,87,0.5)'; g.lineWidth = 2; CM.Partner.roundRect(g, HOME.x, HOME.y, HOME.w, HOME.h, 26); g.stroke();
      g.fillStyle = 'rgba(255,220,200,0.55)'; g.font = '600 22px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('HOME', 700, 486);
      // rooms
      ROOMS.forEach(function (r) {
        g.fillStyle = r.floor; g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = hexA(r.accent, 0.08); g.lineWidth = 1;
        for (var i = r.x; i < r.x + r.w; i += 20) { g.beginPath(); g.moveTo(i, r.y); g.lineTo(i, r.y + r.h); g.stroke(); }
        // big app icon on the floor
        g.fillStyle = hexA(r.accent, 0.12); CM.Partner.roundRect(g, r.x + r.w / 2 - 46, r.y + r.h / 2 - 20, 92, 92, 24); g.fill();
        g.fillStyle = hexA(r.accent, 0.5); g.font = '700 38px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(r.icon, r.x + r.w / 2, r.y + r.h / 2 + 26);
        g.fillStyle = hexA(r.accent, 0.9); g.font = '700 16px system-ui, sans-serif';
        var ly = r.door === 'bottom' ? r.y + r.h + 22 : r.y - 18;
        g.fillText(r.name.toUpperCase(), r.doorX, ly);
      });
      // props
      props.forEach(function (pr) { drawProp(g, pr); });
      // walls
      walls.forEach(function (w) {
        if (props.indexOf(w) >= 0) return;
        g.fillStyle = '#1f2638'; g.fillRect(w.x, w.y, w.w, w.h);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(w.x, w.y, w.w, 3);
      });
      ROOMS.forEach(function (r) {
        g.strokeStyle = hexA(r.accent, 0.55); g.lineWidth = 2; g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      });
      this.staticLayer = c;
    },

    render: function (t) {
      var ctx = this.ctx, z = this.zoom, d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.setTransform(d * z, 0, 0, d * z, -this.cam.x * z * d, -this.cam.y * z * d);
      var sl = this.staticLayer;
      ctx.drawImage(sl, 0, 0, sl.width, sl.height, 0, 0, W, H);

      // animated bits: door glow (Code Lab glows until first visit), code rain, terminal cursor
      var visited = CM.Store.data.progress.stats.roomsVisited;
      ROOMS.forEach(function (r) {
        var glow = 0.25 + 0.2 * Math.sin(t * 3 + r.x);
        if (r.id === 'codelab' && visited.indexOf('codelab') < 0) glow = 0.5 + 0.4 * Math.sin(t * 5);
        ctx.fillStyle = hexA(r.accent, glow);
        ctx.fillRect(r.doorX - 55, r.door === 'bottom' ? r.y + r.h - 6 : r.y + 2, 110, 4);
      });
      if (visited.indexOf('codelab') < 0) { // onboarding arrow
        var cl = ROOMS[0], bounce = Math.sin(t * 4) * 6;
        ctx.fillStyle = '#6cc4ff'; ctx.beginPath();
        ctx.moveTo(cl.doorX, cl.doorY + 30 + bounce); ctx.lineTo(cl.doorX - 12, cl.doorY + 48 + bounce); ctx.lineTo(cl.doorX + 12, cl.doorY + 48 + bounce); ctx.fill();
      }
      ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left';
      for (var i = 0; i < 6; i++) {
        var yy = 110 + ((t * 30 + i * 47) % 280);
        ctx.fillStyle = 'rgba(108,196,255,' + (0.08 + (i % 3) * 0.04) + ')';
        ctx.fillText(['if (ok) {', 'let x = 0;', 'draw();', '}', 'x += 1;', 'return x;'][i], 470 + (i % 2) * 40, yy);
      }
      if (Math.floor(t * 2) % 2) { ctx.fillStyle = '#68d391'; ctx.fillRect(1120, 700, 10, 16); }
      ctx.fillStyle = '#68d391'; ctx.fillText('$ codemate run', 1050, 712);

      // tap target
      if (this.tapTarget) {
        var tt = this.tapTarget, a = 1 - ((performance.now() - tt.t) % 900) / 900;
        ctx.strokeStyle = 'rgba(108,196,255,' + a + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tt.x, tt.y, 6 + (1 - a) * 12, 0, Math.PI * 2); ctx.stroke();
      }

      // entities sorted by y
      var p = this.player, ai = this.ai, self = this;
      var ents = [{ y: p.y, draw: function () { drawPlayer(ctx, p, t); } }, { y: ai.y, draw: function () {
        CM.Partner.draw(ctx, ai.x, ai.y + ai.r, 1, t, { facing: ai.facing, moving: Math.hypot(ai.vx, ai.vy) > 12, lookX: (p.x - ai.x) / 40 * ai.facing, lookY: (p.y - ai.y) / 60, bubble: false });
        if (ai.poof > 0) { ctx.fillStyle = 'rgba(255,255,255,' + ai.poof * 0.6 + ')'; ctx.beginPath(); ctx.arc(ai.x, ai.y - 10, 30 * (1 - ai.poof) + 8, 0, Math.PI * 2); ctx.fill(); }
      } }];
      ents.sort(function (a, b) { return a.y - b.y; }).forEach(function (e) { e.draw(); });
      // speech bubble always on top
      if (CM.Partner.bubble) CM.Partner.drawBubble(ctx, ai.x, Math.min(ai.y + ai.r - 64, p.y + p.r - 62), CM.Partner.bubble.text, 1, 180);
      // name tag
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,136,106,0.9)';
      ctx.fillText(CM.Partner.name, ai.x, ai.y + ai.r + 13);
      void self;
    }
  };

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function drawProp(g, pr) {
    var rr = CM.Partner.roundRect;
    g.save();
    if (pr.kind === 'desk' || pr.kind === 'table') {
      g.fillStyle = '#2b3550'; rr(g, pr.x, pr.y, pr.w, pr.h, 8); g.fill();
      g.fillStyle = '#3a4668'; rr(g, pr.x, pr.y, pr.w, 8, 4); g.fill();
      if (pr.kind === 'desk') for (var i = 0; i < 3; i++) {
        var mx = pr.x + 20 + i * 82;
        g.fillStyle = '#0d1a26'; rr(g, mx, pr.y - 30, 60, 34, 4); g.fill();
        g.strokeStyle = '#6cc4ff'; g.lineWidth = 1.5; rr(g, mx, pr.y - 30, 60, 34, 4); g.stroke();
        g.fillStyle = 'rgba(126,224,181,0.8)'; for (var l = 0; l < 4; l++) g.fillRect(mx + 6 + (l % 2) * 6, pr.y - 24 + l * 6, 20 + (l * 9) % 22, 2);
      }
    } else if (pr.kind === 'server' || pr.kind === 'rack') {
      g.fillStyle = '#1a2233'; rr(g, pr.x, pr.y, pr.w, pr.h, 6); g.fill();
      for (var k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#68d391' : '#6cc4ff'; g.fillRect(pr.x + 8, pr.y + 10 + k * 15, 6, 3); }
    } else if (pr.kind === 'sofa') {
      g.fillStyle = '#7a3d2c'; rr(g, pr.x, pr.y, pr.w, pr.h, 14); g.fill();
      g.fillStyle = '#9c4f37'; rr(g, pr.x + 8, pr.y + 6, pr.w - 16, pr.h - 18, 10); g.fill();
    } else if (pr.kind === 'core') {
      g.fillStyle = 'rgba(232,136,106,0.25)'; g.beginPath(); g.arc(pr.x + 30, pr.y + 30, 34, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8886a'; g.beginPath(); g.arc(pr.x + 30, pr.y + 30, 18, 0, Math.PI * 2); g.fill();
    } else if (pr.kind === 'cabinet') {
      g.fillStyle = '#5c4a1e'; rr(g, pr.x, pr.y, pr.w, pr.h, 6); g.fill();
      g.fillStyle = '#ffd166'; for (var d = 0; d < 3; d++) g.fillRect(pr.x + 22, pr.y + 14 + d * 20, 16, 3);
    } else if (pr.kind === 'gear') {
      g.fillStyle = '#4a5568'; g.beginPath(); g.arc(pr.x + 25, pr.y + 25, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d2230'; g.beginPath(); g.arc(pr.x + 25, pr.y + 25, 9, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  function drawPlayer(ctx, p, t) {
    var bob = p.moving ? Math.abs(Math.sin(t * 13)) * 2.5 : Math.sin(t * 2) * 0.8;
    var face = p.fx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(p.x, p.y + p.r);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    var step = p.moving ? Math.sin(t * 13) * 4 : 0;
    ctx.fillStyle = '#2d3a5c';
    CM.Partner.roundRect(ctx, -8 + step * 0.4, -10, 6, 10, 3); ctx.fill();
    CM.Partner.roundRect(ctx, 2 - step * 0.4, -10, 6, 10, 3); ctx.fill();
    ctx.translate(0, -bob);
    // hoodie body
    ctx.fillStyle = '#4c6ef5'; CM.Partner.roundRect(ctx, -12, -30, 24, 24, 9); ctx.fill();
    // head
    ctx.fillStyle = '#f2d0b5'; ctx.beginPath(); ctx.arc(0, -38, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2b38'; ctx.beginPath(); ctx.arc(0, -41, 11.5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    // eyes look where we're heading
    var ex = p.fx * 3, ey = p.fy * 2;
    ctx.fillStyle = '#1b1f2a';
    if (p.fy < -0.7) { /* facing away: no eyes */ } else {
      ctx.fillRect(-4 + ex - 1, -38 + ey, 2.2, 3.2); ctx.fillRect(3 + ex - 1, -38 + ey, 2.2, 3.2);
    }
    void face;
    ctx.restore();
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(160,190,255,0.85)';
    ctx.fillText('YOU', p.x, p.y + p.r + 13);
  }

  World._test = { collide: collide, lineOfSight: lineOfSight, roomAt: roomAt, walls: function () { return walls; } };
  CM.World = World;
})(typeof self !== 'undefined' ? self : this);
