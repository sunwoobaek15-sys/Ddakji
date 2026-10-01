/* Settings app. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  function field(label, control, help) {
    return el('label.field', {}, [el('span.field-label', { text: label }), control, help ? el('span.muted.small', { text: help }) : null]);
  }

  var Settings = {
    id: 'settings', title: 'Settings',
    mount: function (container) { this.container = container; this.render(); },
    unmount: function () { this.container = null; },
    render: function () {
      var self = this, c = this.container, s = CM.Store.data.settings;
      if (!c) return;
      c.innerHTML = '';
      var name = el('input.input', { value: s.partnerName, attrs: { maxlength: '16' } });
      name.addEventListener('change', function () {
        var v = name.value.trim().slice(0, 16);
        s.partnerName = v || CM.CONFIG.PARTNER_NAME; name.value = s.partnerName;
        CM.Store.save(); CM.Partner.say('Call me ' + s.partnerName + '.', { state: 'HAPPY' });
      });
      var mode = el('select.input', { onchange: function () {
        s.aiMode = mode.value; CM.Store.save();
        CM.AIService.checkHealth().then(function () { self.render(); CM.Phone.statusBar(); });
      } }, [el('option', { value: 'auto', text: 'Auto (online AI when available)' }), el('option', { value: 'offline', text: 'Offline analyzer only' })]);
      mode.value = s.aiMode;
      var delayOut = el('span.muted', { text: s.analyzeDelay + ' ms' });
      var delay = el('input', { attrs: { type: 'range', min: String(CM.CONFIG.ANALYZE_DELAY_MIN), max: String(CM.CONFIG.ANALYZE_DELAY_MAX), step: '50' }, value: String(s.analyzeDelay) });
      delay.addEventListener('input', function () { s.analyzeDelay = +delay.value; delayOut.textContent = delay.value + ' ms'; CM.Store.save(); });
      var deep = el('input', { attrs: { type: 'checkbox' }, checked: s.deepAnalysis, onchange: function () { s.deepAnalysis = deep.checked; CM.Store.save(); } });
      var joy = el('select.input', { onchange: function () { s.joystick = joy.value; CM.Store.save(); CM.Main.applyJoystick(); } },
        [el('option', { value: 'auto', text: 'Auto (touch screens)' }), el('option', { value: 'on', text: 'Always show' }), el('option', { value: 'off', text: 'Hide' })]);
      joy.value = s.joystick;
      var dev = el('input', { attrs: { type: 'checkbox' }, checked: s.devMode, onchange: function () { s.devMode = dev.checked; CM.Store.save(); CM.Dev.toggle(dev.checked); } });
      var st = CM.AIService.status;
      var statusText = st === 'connected' ? 'Connected' + (CM.AIService.model ? ' · ' + CM.AIService.model : '') : st === 'disabled' ? 'Disabled (offline mode)' : 'AI connection unavailable' + (CM.AIService.lastError ? ' — ' + CM.AIService.lastError : '');

      c.appendChild(el('div.settings', {}, [
        el('div.panel', {}, [el('h3', { text: 'Partner' }), field('Partner name', name, '파트너 이름을 바꿀 수 있어.')]),
        el('div.panel', {}, [
          el('h3', { text: 'AI' }),
          field('Mode', mode),
          el('div.field', {}, [el('span.field-label', { text: 'Backend status' }), el('span.' + (st === 'connected' ? 'ok-text' : 'muted'), { text: statusText }),
            el('button.btn.small', { text: 'TEST CONNECTION', onclick: function () { CM.AIService.checkHealth().then(function (ok) { CM.UI.toast(ok ? 'AI connected.' : 'AI connection unavailable. Using the local analyzer.', ok ? 'ok' : 'warn'); self.render(); CM.Phone.statusBar(); }); } })]),
          field('Analysis delay', el('div.range', {}, [delay, delayOut]), '입력을 멈추고 이만큼 지나면 코드를 분석해.'),
          el('label.field.check', {}, [deep, el('span', { text: 'Online deep review (uses the AI backend, only when connected)' })]),
          el('p.muted.small', { text: 'API 키는 브라우저에 저장되지 않아. 서버의 환경 변수(ANTHROPIC_API_KEY)로만 설정해.' })
        ]),
        el('div.panel', {}, [el('h3', { text: 'Controls' }), field('Joystick', joy), el('p.muted.small', { text: 'PC: WASD / 방향키로 이동, E·Enter·Space로 방 열기, Esc로 뒤로가기, F1 개발자 모드.' })]),
        el('div.panel', {}, [el('h3', { text: 'Developer' }), el('label.field.check', {}, [dev, el('span', { text: 'DEV MODE overlay (F1)' })])]),
        el('div.panel.danger-zone', {}, [el('h3', { text: 'Data' }),
          el('p.muted.small', { text: 'Save size: ' + (JSON.stringify(CM.Store.data).length / 1024).toFixed(1) + ' KB' + (CM.Store.available ? '' : ' · storage unavailable') }),
          el('button.btn.danger', { text: 'RESET ALL DATA', onclick: function () { self.reset(); } })]),
        el('p.muted.small.center', { text: CM.CONFIG.GAME_TITLE + ' · ' + CM.CONFIG.SUBTITLE })
      ]));
    },
    reset: function () {
      CM.UI.confirm('Reset everything?', '모든 프로젝트, XP, 업적이 지워져. 되돌릴 수 없어.', 'RESET', true).then(function (ok) {
        if (!ok) return;
        return CM.UI.prompt('Type RESET to confirm', '', 'RESET', function (v) { return v === 'RESET' ? null : 'RESET 이라고 입력해줘.'; }).then(function (v) {
          if (v !== 'RESET') return;
          CM.Main.resetting = true;
          CM.Store.reset();
          location.reload();
        });
      });
    }
  };

  CM.Phone.register(Settings);
})(typeof self !== 'undefined' ? self : this);
