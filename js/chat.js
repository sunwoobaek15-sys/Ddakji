/* Chat with the partner. One shared history, rendered in Code Lab and the AI Room. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util, el = U.el;

  var Chat = {
    history: [], // {role:'user'|'ai', text, extra?}
    views: [],
    busy: false,

    // Mount a chat view. getContext() returns the coding context; handlers: {onApplyIssue, onApplyCode, onGoto, onRun, onHint}
    mount: function (container, getContext, handlers) {
      var log = el('div.chat-log', { attrs: { 'aria-live': 'polite' } });
      var input = el('input.chat-input', { attrs: { placeholder: '"이 코드 뭐가 문제야?"', enterkeyhint: 'send', autocomplete: 'off', 'aria-label': 'Message to partner' } });
      var send = el('button.btn.primary.chat-send', { text: 'SEND' });
      var chips = el('div.chat-chips', {}, ['뭐가 문제야?', '고쳐줘', '힌트', '이 줄 설명해줘'].map(function (q) {
        return el('button.chip', { text: q, onclick: function () { submit(q === '이 줄 설명해줘' && getContext().cursorLine ? 'line ' + getContext().cursorLine + ' 설명해줘' : q); } });
      }));
      var form = el('div.chat-form', {}, [input, send]);
      container.appendChild(log); container.appendChild(chips); container.appendChild(form);
      var view = { log: log, getContext: getContext, handlers: handlers || {} };
      this.views.push(view);
      var self = this;
      function submit(text) {
        text = (text || input.value).trim();
        if (!text || self.busy) return;
        input.value = '';
        self.send(text, view);
      }
      send.addEventListener('click', function () { submit(); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
      this._renderAll(view);
      return function unmount() { var i = self.views.indexOf(view); if (i >= 0) self.views.splice(i, 1); };
    },

    add: function (role, text, extra) {
      var msg = { role: role, text: text, extra: extra || null };
      this.history.push(msg);
      if (this.history.length > 60) this.history.shift();
      var self = this;
      this.views.forEach(function (v) { v.log.appendChild(self._render(msg, v)); v.log.scrollTop = v.log.scrollHeight; });
      return msg;
    },

    _renderAll: function (view) {
      var self = this;
      view.log.innerHTML = '';
      if (!this.history.length) view.log.appendChild(el('div.chat-empty', { text: CM.Partner.name + '에게 코드에 대해 물어봐. 예: "이거 왜 안돼?"' }));
      this.history.forEach(function (m) { view.log.appendChild(self._render(m, view)); });
      view.log.scrollTop = view.log.scrollHeight;
    },

    _render: function (msg, view) {
      var who = msg.role === 'user' ? 'YOU' : CM.Partner.name;
      var bubble = el('div.msg.' + msg.role, {}, [el('div.msg-who', { text: who }), el('div.msg-text', { text: msg.text })]);
      var x = msg.extra, h = view.handlers;
      if (x) {
        if (x.uncertain) bubble.appendChild(el('div.tag.unsure', { text: 'I might be wrong.' }));
        if (x.preview) bubble.appendChild(diffBox(x.preview.before, x.preview.after));
        var actions = el('div.msg-actions');
        if (x.line && h.onGoto) actions.appendChild(el('button.btn.small', { text: 'GO TO LINE ' + x.line, onclick: function () { h.onGoto(x.line, x.file); } }));
        if (x.applyIssue && h.onApplyIssue) actions.appendChild(el('button.btn.small.primary', { text: 'APPLY', onclick: function (e) { e.target.disabled = true; h.onApplyIssue(x.applyIssue); } }));
        if (x.applyCode && h.onApplyCode) actions.appendChild(el('button.btn.small.primary', { text: 'APPLY', onclick: function (e) { e.target.disabled = true; h.onApplyCode(x.applyCode); } }));
        if (x.run && h.onRun) actions.appendChild(el('button.btn.small', { text: '▶ RUN', onclick: function () { h.onRun(); } }));
        if (actions.children.length) bubble.appendChild(actions);
        if (x.source) bubble.appendChild(el('div.msg-src', { text: x.source === 'online' ? 'online AI' : 'local analyzer' }));
      }
      return bubble;
    },

    send: function (text, view) {
      var self = this;
      var ctx = view.getContext();
      ctx.history = this.history.slice(-10);
      this.add('user', text);
      CM.Progress.p.stats.chats++;
      if (CM.Progress.p.stats.chats >= 5) CM.Progress.unlock('chatter');
      this.busy = true;
      CM.Partner.react('THINKING', 8000);
      var typing = el('div.msg.ai.typing', { text: '...' });
      this.views.forEach(function (v) { v.log.appendChild(typing.cloneNode(true)); v.log.scrollTop = v.log.scrollHeight; });
      CM.AIService.chat(text, ctx).then(function (r) {
        self.views.forEach(function (v) { U.$all('.typing', v.log).forEach(function (t) { t.remove(); }); });
        self.busy = false;
        CM.Partner.react('IDLE', 10);
        if (r.hint) { if (view.handlers.onHint) view.handlers.onHint(); else self.add('ai', '미션을 시작하면 힌트를 줄 수 있어. Code Lab에서 MISSION을 눌러봐.'); return; }
        var extra = { line: r.line || null, source: r.source };
        if (r.action === 'run') extra.run = true;
        if (r.fix && r.fix.issueKey) {
          extra.preview = { before: r.fix.before, after: r.fix.after };
          extra.applyIssue = r.fix.issueKey;
        } else if (r.fix && typeof r.fix.code === 'string') {
          var check = validateFix(r.fix, ctx);
          if (check.ok && r.confidence >= 0.7) {
            extra.preview = check.preview;
            extra.applyCode = { file: r.fix.file, code: r.fix.code };
          } else {
            r.reply += '\n(' + (check.ok ? '확실하지 않아서' : check.why) + ' 수정안을 바로 적용하지는 않을게.)';
            extra.uncertain = true;
          }
        }
        if (typeof r.confidence === 'number' && r.confidence < 0.7) extra.uncertain = true;
        self.add('ai', r.reply, extra);
        CM.Partner.say(r.reply.length > 60 ? r.reply.slice(0, 57) + '…' : r.reply, { interrupt: true });
        CM.Store.save();
      }).catch(function (e) {
        self.busy = false;
        CM.reportError(e, 'chat');
        self.views.forEach(function (v) { U.$all('.typing', v.log).forEach(function (t) { t.remove(); }); });
        self.add('ai', '앗, 대답을 만들다가 문제가 생겼어. 다시 물어봐줄래?');
      });
    }
  };

  // An online fix replaces a whole file: it must target an existing file and still parse.
  function validateFix(fix, ctx) {
    var file = (ctx.files || []).filter(function (f) { return f.name === fix.file; })[0];
    if (!file) return { ok: false, why: '"' + fix.file + '" 파일을 찾을 수 없어서' };
    if (/\.js$/.test(fix.file)) {
      var chk = CM.Analyzer.checkSyntax(fix.code);
      if (!chk.ok) return { ok: false, why: '수정안에 문법 오류가 있어서' };
    }
    return { ok: true, preview: lineDiff(file.content, fix.code) };
  }

  // Shows only the changed region of two texts.
  function lineDiff(a, b) {
    var la = a.split('\n'), lb = b.split('\n'), s = 0;
    while (s < la.length && s < lb.length && la[s] === lb[s]) s++;
    var ea = la.length - 1, eb = lb.length - 1;
    while (ea >= s && eb >= s && la[ea] === lb[eb]) { ea--; eb--; }
    return { before: la.slice(s, ea + 1).join('\n') || '(nothing)', after: lb.slice(s, eb + 1).join('\n') || '(removed)', line: s + 1 };
  }

  function diffBox(before, after) {
    return el('div.diff', {}, [
      el('div.diff-h', { text: 'Before' }), el('pre.diff-before', { text: before || '' }),
      el('div.diff-h', { text: 'After' }), el('pre.diff-after', { text: after || '' })
    ]);
  }

  Chat.diffBox = diffBox;
  Chat.lineDiff = lineDiff;
  CM.Chat = Chat;
})(typeof self !== 'undefined' ? self : this);
