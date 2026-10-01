/* The AI partner character: state machine, speech queue and procedural canvas drawing.
 * The same draw() is used in the world, in the Code Lab side panel and in the AI Room. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  var STATES = ['IDLE', 'WALK', 'FOLLOW', 'CODING', 'THINKING', 'WARNING', 'HAPPY', 'CONFUSED', 'SUCCESS', 'ERROR'];
  // Reaction states are temporary; afterwards the partner returns to its base state.
  var HOLD = { WARNING: 3200, HAPPY: 2200, CONFUSED: 2600, SUCCESS: 3200, ERROR: 3400, THINKING: 2400 };
  var LIGHT = { IDLE: '#7ee0b5', WALK: '#7ee0b5', FOLLOW: '#7ee0b5', CODING: '#6cc4ff', THINKING: '#ffd166', WARNING: '#ff6b6b', HAPPY: '#7ee0b5', CONFUSED: '#ffd166', SUCCESS: '#a6ff8f', ERROR: '#ff6b6b' };

  var Partner = {
    STATES: STATES,
    state: 'IDLE',
    base: 'IDLE',
    since: 0,
    holdUntil: 0,
    bubble: null, // { text, until }
    queue: [],
    blinkAt: 0,
    get name() { return (CM.Store && CM.Store.data && CM.Store.data.settings.partnerName) || CM.CONFIG.PARTNER_NAME; },

    setBase: function (s) { this.base = s; if (!this.holdUntil || performance.now() > this.holdUntil) this._set(s); },
    react: function (s, ms) { // temporary reaction state
      this._set(s);
      this.holdUntil = performance.now() + (ms || HOLD[s] || 2000);
    },
    _set: function (s) {
      if (STATES.indexOf(s) < 0) return;
      if (s !== this.state) { this.state = s; this.since = performance.now(); CM.bus.emit('partner:state', s); }
    },
    say: function (text, opts) {
      opts = opts || {};
      var item = { text: String(text), ms: opts.ms || Math.min(5200, 1500 + text.length * 45), state: opts.state };
      if (opts.interrupt) { this.queue.length = 0; this.bubble = null; }
      if (this.queue.length >= 3) this.queue.shift();
      this.queue.push(item);
      CM.bus.emit('partner:say', item);
    },
    update: function () {
      var now = performance.now();
      if (this.holdUntil && now > this.holdUntil) { this.holdUntil = 0; this._set(this.base); }
      if (this.bubble && now > this.bubble.until) this.bubble = null;
      if (!this.bubble && this.queue.length) {
        var it = this.queue.shift();
        this.bubble = { text: it.text, until: now + it.ms, start: now };
        if (it.state) this.react(it.state);
      }
    },

    // ctx at any transform; (x, y) is the ground point between the feet.
    draw: function (ctx, x, y, scale, t, o) {
      o = o || {};
      var s = this.state, face = o.facing || 1;
      var walking = s === 'WALK' || s === 'FOLLOW' || o.moving;
      var bob = walking ? Math.abs(Math.sin(t * 12)) * 3 : Math.sin(t * 2.2) * 1.2;
      if (s === 'HAPPY' || s === 'SUCCESS') bob = Math.abs(Math.sin(t * 8)) * 5;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 5, 0, 0, Math.PI * 2); ctx.fill();

      // legs
      ctx.fillStyle = '#9c4f37';
      var step = walking ? Math.sin(t * 12) * 4 : 0;
      roundRect(ctx, -9 + step * 0.3, -9, 6, 9, 3); ctx.fill();
      roundRect(ctx, 3 - step * 0.3, -9, 6, 9, 3); ctx.fill();

      ctx.translate(0, -bob);
      ctx.scale(face, 1);
      var tilt = s === 'CONFUSED' ? 0.22 : s === 'THINKING' ? -0.06 : 0;
      ctx.rotate(tilt);

      // antenna + status light
      ctx.strokeStyle = '#9c4f37'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -38); ctx.quadraticCurveTo(3, -45, 1, -49); ctx.stroke();
      var pulse = 0.6 + 0.4 * Math.sin(t * (s === 'THINKING' ? 10 : 3));
      ctx.fillStyle = LIGHT[s] || '#7ee0b5';
      ctx.globalAlpha = 0.35 * pulse; ctx.beginPath(); ctx.arc(1, -50, 6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(1, -50, 3, 0, Math.PI * 2); ctx.fill();

      // body
      var g = ctx.createLinearGradient(0, -40, 0, -6);
      g.addColorStop(0, '#e8886a'); g.addColorStop(1, '#c4613f');
      ctx.fillStyle = g;
      roundRect(ctx, -16, -40, 32, 34, 13); ctx.fill();

      // face screen
      ctx.fillStyle = '#251a17';
      roundRect(ctx, -11, -34, 22, 14, 6); ctx.fill();
      this._eyes(ctx, s, t, o);

      // laptop
      this._laptop(ctx, s, t);

      ctx.restore();

      // floating indicator (not mirrored)
      ctx.save();
      ctx.translate(x, y - (58 + bob) * scale);
      ctx.scale(scale, scale);
      this._indicator(ctx, s, t);
      ctx.restore();

      if (o.bubble !== false && this.bubble) drawBubble(ctx, x, y - (66 + bob) * scale, this.bubble.text, scale, o.bubbleMax || 170);
    },

    _eyes: function (ctx, s, t, o) {
      var lx = 0, ly = 0;
      if (s === 'CODING') { ly = 2; lx = 2; }
      else if (s === 'THINKING') { ly = -2; lx = 2; }
      else if (o.lookX !== undefined) { lx = Math.max(-2, Math.min(2, o.lookX)); ly = Math.max(-1.5, Math.min(1.5, o.lookY || 0)); }
      var now = t * 1000;
      if (now > this.blinkAt + 120 && Math.random() < 0.004) this.blinkAt = now;
      var blink = now - this.blinkAt < 120;
      ctx.strokeStyle = ctx.fillStyle = s === 'ERROR' || s === 'WARNING' ? '#ff8f8f' : '#8ff0ff';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      var ex = [-5 + lx, 5 + lx], ey = -27 + ly;
      if (s === 'HAPPY' || s === 'SUCCESS') {
        ex.forEach(function (x) { ctx.beginPath(); ctx.arc(x, ey + 1.5, 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); });
      } else if (s === 'ERROR') {
        ex.forEach(function (x) { ctx.beginPath(); ctx.moveTo(x - 2.5, ey - 2.5); ctx.lineTo(x + 2.5, ey + 2.5); ctx.moveTo(x + 2.5, ey - 2.5); ctx.lineTo(x - 2.5, ey + 2.5); ctx.stroke(); });
      } else if (s === 'WARNING') {
        ex.forEach(function (x) { ctx.beginPath(); ctx.arc(x, ey, 3.2, 0, Math.PI * 2); ctx.stroke(); });
      } else if (s === 'CONFUSED') {
        ctx.beginPath(); ctx.arc(ex[0], ey, 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(ex[1] - 2.5, ey - 0.8, 5, 1.8);
      } else if (blink) {
        ex.forEach(function (x) { ctx.fillRect(x - 2.5, ey, 5, 1.5); });
      } else {
        ex.forEach(function (x) { roundRect(ctx, x - 2, ey - 3, 4, 6, 2); ctx.fill(); });
      }
    },

    _laptop: function (ctx, s, t) {
      ctx.save();
      ctx.translate(4, -12);
      // arms
      ctx.strokeStyle = '#c4613f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      var tap = s === 'CODING' ? Math.sin(t * 28) * 1.5 : 0;
      ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-2, -1 + tap); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, -10); ctx.lineTo(12, -1 - tap); ctx.stroke();
      if (s === 'SUCCESS') { // laptop closed
        ctx.fillStyle = '#b8c2cc'; roundRect(ctx, -6, -2, 22, 4, 1.5); ctx.fill();
        ctx.restore(); return;
      }
      // base
      ctx.fillStyle = '#c9d2db'; roundRect(ctx, -6, -1, 22, 4, 1.5); ctx.fill();
      // screen (angled up)
      ctx.save();
      ctx.translate(-5, -1);
      ctx.transform(1, 0, -0.25, 1, 0, 0);
      ctx.fillStyle = '#9aa5b1'; roundRect(ctx, 0, -14, 20, 14, 2); ctx.fill();
      var scr = s === 'ERROR' || s === 'WARNING' ? '#3a1414' : '#0d1a26';
      ctx.fillStyle = scr; ctx.fillRect(1.5, -12.5, 17, 11);
      // code lines
      var cols = s === 'ERROR' || s === 'WARNING' ? ['#ff6b6b', '#ff9f9f'] : ['#6cc4ff', '#7ee0b5', '#ffd166', '#c792ea'];
      var scroll = s === 'CODING' ? Math.floor(t * 6) : 0;
      for (var i = 0; i < 4; i++) {
        var w = 4 + ((i + scroll) * 7 % 9);
        ctx.fillStyle = cols[(i + scroll) % cols.length];
        ctx.fillRect(3 + (i % 2) * 2, -11 + i * 2.5, Math.min(w, 13), 1.3);
      }
      if (s === 'ERROR') { ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(7, -10); ctx.lineTo(13, -4); ctx.moveTo(13, -10); ctx.lineTo(7, -4); ctx.stroke(); }
      ctx.restore();
      ctx.restore();
    },

    _indicator: function (ctx, s, t) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (s === 'THINKING') {
        for (var i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - i * 0.8));
          ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(-8 + i * 8, 0, 2.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (s === 'WARNING' || s === 'ERROR') {
        ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.fillText(s === 'WARNING' ? '!' : '✕', 0, Math.sin(t * 9) * 1.5);
      } else if (s === 'CONFUSED') {
        ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px system-ui, sans-serif'; ctx.fillText('?', 4, Math.sin(t * 4) * 2);
      } else if (s === 'HAPPY' || s === 'SUCCESS') {
        ctx.fillStyle = s === 'SUCCESS' ? '#a6ff8f' : '#ffd166';
        for (var k = 0; k < 3; k++) {
          var a = t * 2 + k * 2.1, r = 14;
          star(ctx, Math.cos(a) * r, Math.sin(a) * 5, 2.5 + Math.sin(t * 6 + k));
        }
      }
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, rr = i % 2 ? r * 0.4 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function wrap(ctx, text, maxW) {
    var words = text.split(/(\s+)/), lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur + w;
      if (ctx.measureText(test).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trim(); }
      else cur = test;
    });
    if (cur.trim()) lines.push(cur.trim());
    // hard-break very long words (Korean sentences without spaces etc.)
    var out = [];
    lines.forEach(function (l) {
      while (ctx.measureText(l).width > maxW && l.length > 1) {
        var n = l.length; while (n > 1 && ctx.measureText(l.slice(0, n)).width > maxW) n--;
        out.push(l.slice(0, n)); l = l.slice(n);
      }
      out.push(l);
    });
    return out.slice(0, 4);
  }
  function drawBubble(ctx, x, y, text, scale, maxW) {
    ctx.save();
    var fs = Math.max(11, Math.round(12 * Math.min(1.25, scale)));
    ctx.font = '600 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    var lines = wrap(ctx, text, maxW * Math.min(1.2, scale));
    var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 18;
    var lh = fs * 1.3, h = lines.length * lh + 12;
    var bx = x - w / 2, by = y - h - 8;
    ctx.fillStyle = 'rgba(250,250,255,0.96)';
    ctx.strokeStyle = 'rgba(217,119,87,0.9)'; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, w, h, 9); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, by + h - 0.5); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 6, by + h - 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b1f2a'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach(function (l, i) { ctx.fillText(l, x, by + 6 + i * lh); });
    ctx.restore();
  }

  Partner.roundRect = roundRect;
  Partner.drawBubble = drawBubble;
  CM.Partner = Partner;
})(typeof self !== 'undefined' ? self : this);
