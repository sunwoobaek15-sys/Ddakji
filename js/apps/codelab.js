/* Code Lab: editor + live analysis + partner reactions + run + missions. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var U = CM.util, el = U.el;

  var infoCache = new Map(); // file content -> fileInfo
  function cachedInfo(f) {
    var k = f.name + '\u0000' + f.content;
    if (!infoCache.has(k)) { if (infoCache.size > 60) infoCache.clear(); infoCache.set(k, CM.Analyzer.fileInfo(f.content, f.name)); }
    return infoCache.get(k);
  }

  // Clean window used to know real browser globals (our own page adds globals like CM).
  var cleanWin = null;
  function hostGlobal(name) {
    try {
      if (!cleanWin) {
        var f = document.createElement('iframe'); f.style.display = 'none'; f.setAttribute('aria-hidden', 'true');
        document.body.appendChild(f); cleanWin = f.contentWindow;
      }
      return name in cleanWin;
    } catch (e) { return false; }
  }

  var SPEECH = {
    TYPO: { text: 'Typo detected.', state: 'CONFUSED' },
    SYNTAX_ERROR: { text: 'Something is wrong here.', state: 'WARNING' },
    UNUSED_VARIABLE: { text: 'This variable doesn\'t seem to be used.', state: 'THINKING' },
    DUPLICATED_CODE: { text: 'You could turn this into a function.', state: 'THINKING' },
    SIMPLIFICATION: { text: 'You could simplify this.', state: 'THINKING' },
    POSSIBLE_BUG: { text: 'I think I found something.', state: 'WARNING' }
  };
  var ICON = { TYPO: '⚠', SYNTAX_ERROR: '✕', UNUSED_VARIABLE: '◌', DUPLICATED_CODE: '⧉', POSSIBLE_BUG: '!', STYLE: '✎', SIMPLIFICATION: '✦' };
  var LABEL = { TYPO: 'TYPO', SYNTAX_ERROR: 'SYNTAX ERROR', UNUSED_VARIABLE: 'UNUSED VARIABLE', DUPLICATED_CODE: 'DUPLICATED CODE', POSSIBLE_BUG: 'POSSIBLE BUG', STYLE: 'STYLE', SIMPLIFICATION: 'SIMPLIFICATION' };

  var Lab = {
    id: 'codelab',
    title: 'Code Lab',
    m: null, // mounted state

    mount: function (container, params) {
      var self = this;
      var project = CM.Store.project();
      var m = this.m = {
        project: project, file: null, analysis: null, analyzedCode: null, prevIssues: new Map(), applied: new Set(),
        typingShown: false, lastRunError: null, hadRunError: false, view: 'code', deepTimer: null, onlineIssues: [], unsub: [], firstAnalysis: true
      };
      var wide = function () { return container.clientWidth >= 860; };

      // --- toolbar ---
      var projBtn = el('button.tb-btn.proj', { text: '◆ ' + project.name, title: 'Projects', onclick: function () { CM.Phone.open('projects'); } });
      var fileSel = el('select.tb-select.file-select', { attrs: { 'aria-label': 'File' }, onchange: function () { self.openFile(fileSel.value); } });
      var missionBtn = el('button.tb-btn', { text: '⚑ MISSION', onclick: function () { self.pickMission(); } });
      var runBtn = el('button.tb-btn.run', { text: '▶ RUN', title: 'Run (Ctrl+Enter)', onclick: function () { self.run(); } });
      var toolbar = el('div.cl-toolbar', {}, [projBtn, fileSel, el('div.spacer'), missionBtn, runBtn]);

      // --- mission bar ---
      var missionBar = el('div.mission-bar.hidden');

      // --- files ---
      var fileList = el('div.file-list');
      var files = el('aside.cl-files', {}, [el('div.side-h', {}, [el('span', { text: 'FILES' }), el('button.icon-btn', { text: '+', title: 'New file', attrs: { 'aria-label': 'New file' }, onclick: function () { self.newFile(); } })]), fileList]);

      // --- editor + extra keys + output ---
      var edHost = el('div.ed-host');
      var keys = el('div.extra-keys');
      ['⇥', '{', '}', '(', ')', '[', ']', ';', '=', '"', "'", '.', ',', '<', '>', '+', '-', '!', '&', '|'].forEach(function (k) {
        var b = el('button.key', { text: k, attrs: { tabindex: '-1' } });
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); self.editor.insertAtCursor(k === '⇥' ? '  ' : k); });
        keys.appendChild(b);
      });
      var mini = el('canvas.mini-partner', { width: 240, height: 90, attrs: { 'aria-hidden': 'true' } });
      var miniBtn = el('button.mini-hit', { title: 'Open AI panel', attrs: { 'aria-label': 'Open AI panel' }, onclick: function () { self.setView('ai'); } });
      var outBanner = el('div.run-banner.idle', { text: 'Press ▶ RUN to execute your code.' });
      var consoleEl = el('div.console', { attrs: { role: 'log' } });
      var preview = el('div.preview');
      var outTabs = el('div.out-tabs', {}, [
        el('button.tab.active', { text: 'Console', 'data-t': 'console', onclick: function () { self.outTab('console'); } }),
        el('button.tab', { text: 'Preview', onclick: function () { self.outTab('preview'); } }),
        el('div.spacer'),
        el('button.tab', { text: '■ Stop', onclick: function () { CM.Sandbox.stop(); self.banner('idle', 'Stopped.'); } }),
        el('button.tab', { text: 'Clear', onclick: function () { consoleEl.innerHTML = ''; } })
      ]);
      var output = el('section.cl-output', {}, [outTabs, outBanner, consoleEl, preview]);
      var center = el('div.cl-center', {}, [missionBar, el('div.ed-wrap', {}, [edHost, mini, miniBtn]), keys, output]);

      // --- AI side panel ---
      var stage = el('canvas.stage', { width: 300, height: 150, attrs: { 'aria-label': CM.Partner.name + ' is coding next to you' } });
      var modeLabel = el('div.mode-label');
      var issuesEl = el('div.issues', { attrs: { 'aria-live': 'polite' } });
      var chatHost = el('div.chat');
      var side = el('aside.cl-side', {}, [el('div.stage-wrap', {}, [stage, modeLabel]), el('div.side-h', {}, [el('span', { text: 'ASSISTANT' }), el('span.count')]), issuesEl, el('div.side-h', {}, [el('span', { text: 'CHAT' })]), chatHost]);

      // --- mobile view tabs ---
      var tabs = el('div.cl-tabs', {}, [['code', 'Code'], ['ai', 'AI'], ['run', 'Run']].map(function (t) {
        return el('button.tab', { text: t[1], 'data-v': t[0], onclick: function () { self.setView(t[0]); } }, t[0] === 'ai' ? [el('span.badge.hidden')] : []);
      }));

      var main = el('div.cl-main', {}, [files, center, side]);
      var rootEl = el('div.codelab', {}, [toolbar, tabs, main]);
      container.appendChild(rootEl);
      Object.assign(m, { root: rootEl, fileSel: fileSel, fileList: fileList, missionBar: missionBar, issuesEl: issuesEl, consoleEl: consoleEl, preview: preview, outBanner: outBanner, outTabs: outTabs, stage: stage, mini: mini, modeLabel: modeLabel, tabs: tabs, keys: keys, wide: wide, center: center });

      this.editor = new CM.Editor(edHost, {
        onChange: function (text) { self.onChange(text); },
        onSave: function () { CM.Store.saveNow(); CM.UI.toast('Saved.', 'ok', 1200); },
        onRun: function () { self.run(); },
        onFocus: function (f) { rootEl.classList.toggle('typing', f); },
        label: function () { return m.file ? m.file.name : ''; }
      });
      m.unsubChat = CM.Chat.mount(chatHost, function () { return self.context(); }, {
        onGoto: function (line, file) { self.goto(line, file); },
        onApplyIssue: function (key) { var i = self.findIssue(key); if (i) self.applyFix(i); else CM.UI.toast('코드가 바뀌어서 그 수정안은 더 이상 맞지 않아.', 'warn'); },
        onApplyCode: function (fix) { self.applyWholeFile(fix); },
        onRun: function () { self.run(); },
        onHint: function () { self.hint(); }
      });

      this.analyzeSoon = U.debounce(function () { self.analyzeNow(); }, function () { return CM.Store.data.settings.analyzeDelay; });
      m.unsub.push(CM.bus.on('ai:status', function () { self.updateMode(); }));
      this._stageDraw = function (t) { self.drawStage(t); };
      CM.Stages.add(this._stageDraw);

      this.refreshFiles();
      this.openFile(params.file || project.activeFile, true);
      this.updateMode();
      this.setView(params.view || 'code');
      CM.Partner.setBase('CODING');
      if (CM.Progress.unlock('lab_rat')) CM.Partner.say('Let\'s start with something simple.', { state: 'HAPPY' });
      else CM.Partner.say(CM.Progress.bondLine(), { state: 'HAPPY' });
      if (params.mission) this.startMission(params.mission);
      if (params.run) this.run();
    },

    update: function (params) {
      if (params.file) this.openFile(params.file);
      if (params.mission) this.startMission(params.mission);
      if (params.view) this.setView(params.view);
    },

    unmount: function () {
      var m = this.m;
      if (!m) return;
      this.analyzeSoon.flush();
      CM.Stages.remove(this._stageDraw);
      m.unsub.forEach(function (f) { f(); });
      if (m.unsubChat) m.unsubChat();
      clearTimeout(m.deepTimer);
      CM.Sandbox.stop();
      this.editor.destroy();
      CM.Store.saveNow();
      this.m = null;
    },

    onBack: function () {
      if (this.m && !this.m.wide() && this.m.view !== 'code') { this.setView('code'); return true; }
      return false;
    },

    setView: function (v) {
      var m = this.m;
      m.view = v;
      m.root.setAttribute('data-view', v);
      U.$all('.tab', m.tabs).forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-v') === v); });
      if (v === 'run') this.outTab(m.outTab || 'console');
    },

    outTab: function (t) {
      var m = this.m;
      m.outTab = t;
      m.root.setAttribute('data-out', t);
      U.$all('.tab', m.outTabs).forEach(function (b, i) { if (i < 2) b.classList.toggle('active', (i === 0) === (t === 'console')); });
    },

    // ---------- files ----------
    refreshFiles: function () {
      var m = this.m, self = this, p = m.project;
      m.fileSel.innerHTML = '';
      m.fileList.innerHTML = '';
      p.files.forEach(function (f) {
        m.fileSel.appendChild(el('option', { value: f.name, text: f.name }));
        m.fileList.appendChild(el('button.file' + (m.file && m.file.name === f.name ? '.active' : ''), {
          onclick: function () { self.openFile(f.name); }, attrs: { 'data-file': f.name }
        }, [el('span.ficon.' + CM.Analyzer.languageOf(f.name), { text: { js: 'JS', html: '<>', css: '#', text: '¶' }[CM.Analyzer.languageOf(f.name)] }), el('span', { text: f.name })]));
      });
      if (m.file) m.fileSel.value = m.file.name;
    },

    openFile: function (name, initial) {
      var m = this.m, p = m.project;
      var f = p.files.filter(function (x) { return x.name === name; })[0] || p.files[0];
      if (!initial && m.file === f) return;
      if (m.file && !initial) { this.analyzeSoon.cancel(); }
      m.file = f;
      p.activeFile = f.name;
      CM.Store.save();
      this.editor.setValue(f.content, CM.Analyzer.languageOf(f.name));
      m.prevIssues = new Map();
      m.onlineIssues = [];
      m.firstAnalysis = true;
      U.$all('.file', m.fileList).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-file') === f.name); });
      m.fileSel.value = f.name;
      this.updateMissionBar();
      this.analyzeNow();
      if (m.lastRunError && m.lastRunError.file === f.name) this.editor.setRuntimeLine(m.lastRunError.line);
    },

    newFile: function () {
      var self = this, p = this.m.project;
      if (p.files.length >= CM.CONFIG.MAX_FILES) { CM.UI.toast('파일은 최대 ' + CM.CONFIG.MAX_FILES + '개까지 만들 수 있어.', 'warn'); return; }
      CM.UI.prompt('New file', '', 'enemy.js', function (v) {
        if (!CM.Store.FILE_RE.test(v)) return '영문, 숫자, . - _ 만 쓸 수 있어. 예: enemy.js';
        if (!/\.(js|html|css|txt|md|json)$/.test(v)) return '.js .html .css .txt .md .json 파일만 만들 수 있어.';
        if (p.files.some(function (f) { return f.name === v; })) return '같은 이름의 파일이 이미 있어.';
        return null;
      }).then(function (name) {
        if (!name || !self.m) return;
        p.files.push({ name: name, content: /\.js$/.test(name) ? '// ' + name + '\n' : '' });
        p.updated = Date.now();
        CM.Store.save();
        self.refreshFiles();
        self.openFile(name);
        CM.Partner.say('New file. Let\'s fill it in.', { state: 'HAPPY' });
      });
    },

    goto: function (line, file) {
      if (file && this.m.file.name !== file && this.m.project.files.some(function (f) { return f.name === file; })) this.openFile(file);
      this.setView('code');
      this.editor.gotoLine(line);
    },

    // ---------- typing & analysis ----------
    onChange: function (text) {
      var m = this.m;
      if (text.length > CM.CONFIG.MAX_FILE_CHARS) { CM.UI.toast('파일이 너무 커. 일부는 저장되지 않을 수 있어.', 'warn'); text = text.slice(0, CM.CONFIG.MAX_FILE_CHARS); }
      m.file.content = text;
      m.project.updated = Date.now();
      CM.Store.save();
      if (this.editor.runtimeLine) this.editor.runtimeLine = null;
      CM.Partner.setBase('CODING');
      if (!m.typingShown && !CM.Partner.bubble) { m.typingShown = true; CM.Partner.say('...', { ms: 1200 }); }
      this.analyzeSoon();
    },

    context: function () {
      var m = this.m;
      if (!m) return { files: [] };
      var mission = this.currentMission();
      return {
        code: m.file.content, file: m.file.name, files: m.project.files, issues: m.analysis ? m.analysis.issues : [],
        lastError: m.lastRunError, mission: mission, cursorLine: this.editor.cursorLine(),
        declared: (m.analysis && m.analysis.info.decls || []).concat(this.projectContext().globals)
      };
    },

    projectContext: function () {
      var m = this.m, cur = m.file, isMission = /^mission\d+\.js$/.test(cur.name);
      var globals = [], usages = [], props = [], ids = [], htmlText = '';
      m.project.files.forEach(function (f) {
        if (f === cur) return;
        var info = cachedInfo(f);
        if (/\.html?$/.test(f.name)) { ids = ids.concat(info.ids || []); htmlText += f.content; return; }
        if (!/\.js$/.test(f.name) || isMission || /^mission\d+\.js$/.test(f.name)) return;
        globals = globals.concat(info.decls); usages = usages.concat(info.refs); props = props.concat(info.propNames);
      });
      return { globals: globals, usages: usages, props: props, ids: ids, htmlText: htmlText, isMission: isMission, fileNames: m.project.files.map(function (f) { return f.name; }) };
    },

    analyzeNow: function () {
      var m = this.m;
      if (!m) return;
      var code = m.file.content, pc = this.projectContext();
      var t0 = performance.now();
      var res = CM.AIService.analyzeCode(code, {
        fileName: m.file.name, projectGlobals: pc.globals, projectUsages: pc.usages, projectProps: pc.props,
        htmlIds: pc.ids, htmlText: pc.htmlText, isMission: pc.isMission, fileNames: pc.fileNames, ignored: m.project.ignored, hostGlobals: hostGlobal
      });
      CM.Dev.analysisMs = Math.round((performance.now() - t0) * 10) / 10;
      if (res.internalError) console.warn('[CODEMATE] analyzer internal error:', res.internalError);
      m.analysis = res;
      m.analyzedCode = code;
      m.typingShown = false;
      this.renderIssues();
      this.react(res);
      this.scheduleDeep();
    },

    scheduleDeep: function () {
      var m = this.m, self = this;
      clearTimeout(m.deepTimer);
      m.onlineIssues = [];
      if (!CM.AIService.online || !CM.Store.data.settings.deepAnalysis || !m.analysis.parsed) return;
      m.deepTimer = setTimeout(function () {
        var code = m.file.content;
        CM.AIService.deepAnalyze(self.context()).then(function (list) {
          if (!self.m || !list || m.file.content !== code) return;
          m.onlineIssues = list;
          self.renderIssues();
          if (list.length) CM.Partner.say('I took a closer look.', { state: 'THINKING' });
        });
      }, CM.CONFIG.DEEP_ANALYZE_DELAY);
    },

    allIssues: function () { return (this.m.analysis ? this.m.analysis.issues : []).concat(this.m.onlineIssues || []); },
    findIssue: function (key) { return this.allIssues().filter(function (i) { return i.key === key; })[0] || null; },

    // Partner reacts to *changes* in what the analyzer sees, so it doesn't nag.
    react: function (res) {
      var m = this.m, prev = m.prevIssues, P = CM.Partner, self = this;
      var current = new Map();
      res.issues.forEach(function (i) { current.set(i.key, i); });
      var notable = function (i) { return i.severity !== 'info' || i.type === 'DUPLICATED_CODE' || i.type === 'SIMPLIFICATION'; };
      var fresh = res.issues.filter(function (i) { return !prev.has(i.key) && notable(i); });
      var hadProblems = Array.from(prev.values()).some(function (i) { return i.severity !== 'info'; });
      var hasProblems = res.issues.some(function (i) { return i.severity !== 'info'; });

      // XP for problems the player fixed by hand
      prev.forEach(function (i, key) {
        if (current.has(key) || m.applied.has(key)) return;
        if (i.type === 'TYPO' && i.suggestion && m.file.content.indexOf(i.suggestion) >= 0 && !new RegExp('\\b' + i.word.replace(/[^\w]/g, '') + '\\b').test(m.file.content)) self.reward(i, true);
        else if (i.type === 'SYNTAX_ERROR' && res.parsed) self.reward(i, true);
        else if (i.type === 'POSSIBLE_BUG' && i.severity === 'error' && res.parsed) self.reward(i, true);
      });

      if (fresh.length && !(m.firstAnalysis && !hasProblems)) {
        var top = fresh[0], sp = SPEECH[top.type] || SPEECH.POSSIBLE_BUG;
        P.say('...', { ms: 500, state: 'THINKING', interrupt: true });
        if (top.type === 'TYPO') P.say('Typo detected.', { state: 'CONFUSED' });
        else if (top.type === 'SYNTAX_ERROR' || (top.type === 'POSSIBLE_BUG' && top.severity === 'error')) { P.say(sp.text, { state: 'WARNING' }); P.say('Check line ' + top.line + '.', { state: 'WARNING' }); }
        else if (top.type === 'POSSIBLE_BUG') { P.say('I think I found something.', { state: 'THINKING' }); P.say('Check line ' + top.line + '.', { state: 'WARNING' }); }
        else P.say(sp.text, { state: sp.state });
        this.badge(fresh.length);
      } else if (hadProblems && !hasProblems && m.file.content.trim()) {
        P.say('Looks good.', { state: 'HAPPY', interrupt: true });
      } else if (m.firstAnalysis && !hasProblems && m.file.content.trim() && res.language === 'js') {
        P.say('Looks good.', { state: 'HAPPY' });
      }
      m.firstAnalysis = false;
      m.prevIssues = current;
      this.editor.setIssues(this.allIssues());
    },

    badge: function (n) {
      var b = U.$('.cl-tabs .badge', this.m.root);
      if (!b || this.m.wide() || this.m.view === 'ai') return;
      b.textContent = n; b.classList.remove('hidden');
      clearTimeout(this._badgeT);
      this._badgeT = setTimeout(function () { b.classList.add('hidden'); }, 6000);
    },

    renderIssues: function () {
      var m = this.m, self = this, list = this.allIssues();
      m.issuesEl.innerHTML = '';
      var count = U.$('.side-h .count', m.root);
      if (count) count.textContent = list.length ? list.length + '' : '';
      if (this.editor) this.editor.setIssues(list);
      if (!list.length) {
        m.issuesEl.appendChild(el('div.issue.good', {}, [el('div.issue-h', {}, [el('span.ico', { text: '✓' }), el('strong', { text: 'Looks good.' })]), el('p', { text: m.file.content.trim() ? '지금 이 파일에서는 문제가 보이지 않아. RUN으로 실행해봐!' : '코드를 입력하면 같이 볼게.' })]));
        return;
      }
      list.forEach(function (i) {
        var card = el('div.issue.' + i.severity + '.t-' + i.type.toLowerCase());
        card.appendChild(el('div.issue-h', {}, [
          el('span.ico', { text: ICON[i.type] || '•' }),
          el('strong', { text: LABEL[i.type] || i.type }),
          el('button.line-chip', { text: 'line ' + i.line, onclick: function () { self.goto(i.line); } })
        ]));
        card.appendChild(el('div.issue-title', { text: i.title }));
        if (i.word && i.suggestion) card.appendChild(el('div.swap', {}, [el('code.from', { text: i.word }), el('span', { text: ' → ' }), el('code.to', { text: i.suggestion })]));
        card.appendChild(el('p', { text: i.message }));
        if (i.confidence < 0.75) card.appendChild(el('div.tag.unsure', { text: 'I might be wrong.' }));
        if (i.source === 'online') card.appendChild(el('div.tag', { text: 'online AI review' }));
        var pv = i.fix || i.preview;
        if (pv && (pv.before || pv.after) && (i.type === 'DUPLICATED_CODE' || i.type === 'SIMPLIFICATION' || i.fix && i.fix.kind !== 'FIX')) {
          card.appendChild(CM.Chat.diffBox(pv.before, pv.after));
        }
        var actions = el('div.issue-actions');
        if (i.fix) {
          actions.appendChild(el('button.btn.small.primary', { text: i.fix.label, onclick: function () { self.applyFix(i); } }));
        }
        if (i.keepable || i.fix && i.fix.kind === 'REMOVE') actions.appendChild(el('button.btn.small', { text: 'KEEP', onclick: function () { self.keep(i); } }));
        else if (i.fix && i.fix.kind === 'APPLY' || i.type === 'DUPLICATED_CODE' || i.type === 'STYLE') actions.appendChild(el('button.btn.small', { text: 'NO THANKS', onclick: function () { self.keep(i); } }));
        actions.appendChild(el('button.btn.small.ghost', { text: 'WHY?', onclick: function () { self.why(i); } }));
        card.appendChild(actions);
        m.issuesEl.appendChild(card);
      });
    },

    // ---------- fixes (always player-confirmed: this runs only from a button) ----------
    applyFix: function (issue) {
      var m = this.m;
      if (!issue.fix) return;
      if (m.file.content !== m.analyzedCode) { // code changed since analysis: re-check first
        this.analyzeNow();
        var again = this.findIssue(issue.key);
        if (!again || !again.fix) { CM.UI.toast('코드가 바뀌어서 다시 확인했어. 이제 그 문제는 없어.', 'info'); return; }
        issue = again;
      }
      var next = CM.Analyzer.applyEdits(m.file.content, issue.fix.edits);
      m.applied.add(issue.key);
      this.editor.applyText(next);
      m.file.content = this.editor.getValue();
      CM.Store.save();
      this.analyzeSoon.cancel();
      this.analyzeNow();
      this.reward(issue, false);
      var P = CM.Partner;
      if (issue.fix.kind === 'REMOVE') P.say('Removed. Cleaner now.', { state: 'HAPPY', interrupt: true });
      else if (issue.fix.kind === 'APPLY') P.say('Nice refactor.', { state: 'HAPPY', interrupt: true });
      else P.say('Fixed!', { state: 'HAPPY', interrupt: true });
      if (!m.analysis.issues.some(function (i) { return i.severity !== 'info'; })) P.say('Looks good.', { state: 'HAPPY' });
    },

    applyWholeFile: function (fix) {
      var m = this.m;
      var f = m.project.files.filter(function (x) { return x.name === fix.file; })[0];
      if (!f) return;
      if (/\.js$/.test(f.name) && !CM.Analyzer.checkSyntax(fix.code).ok) { CM.UI.toast('수정안에 문법 오류가 있어서 적용하지 않았어.', 'warn'); return; }
      if (m.file !== f) this.openFile(f.name);
      this.editor.applyText(fix.code);
      f.content = this.editor.getValue();
      CM.Store.save();
      this.analyzeNow();
      CM.Partner.say('Applied. Let\'s run it.', { state: 'HAPPY', interrupt: true });
    },

    reward: function (i, manual) {
      var X = CM.CONFIG.XP, P = CM.Progress, key = this.m.project.id + ':' + this.m.file.name + ':' + i.key;
      if (i.type === 'TYPO') { if (P.addXP(X.TYPO_FIX, 'Typo fixed', key)) { P.unlock('typo_hunter'); P.skill('syntax'); P.p.stats.fixes++; } }
      else if (i.type === 'SYNTAX_ERROR') { if (P.addXP(X.SYNTAX_FIX, 'Syntax error fixed', key)) { P.unlock('syntax_slayer'); P.skill('syntax', 2); P.p.stats.fixes++; } }
      else if (i.type === 'UNUSED_VARIABLE') { if (P.addXP(X.CLEANUP, 'Cleaned up', key)) { P.unlock('clean_coder'); P.skill('clean'); } }
      else if (i.type === 'DUPLICATED_CODE' || i.type === 'SIMPLIFICATION') { if (P.addXP(X.REFACTOR, 'Refactored', key)) { P.unlock('refactorer'); P.skill('clean', 2); } }
      else if (i.type === 'POSSIBLE_BUG') { if (P.addXP(X.SYNTAX_FIX, 'Bug fixed', key)) { P.skill('debugging'); P.p.stats.fixes++; } }
      else if (i.type === 'STYLE' && !manual) P.addXP(2, 'Style', key);
      if (manual && (i.type === 'TYPO' || i.type === 'SYNTAX_ERROR')) CM.Partner.say(i.type === 'TYPO' ? 'You fixed the typo.' : 'Syntax looks right now.', { state: 'HAPPY' });
    },

    keep: function (i) {
      var p = this.m.project;
      if (p.ignored.indexOf(i.key) < 0) p.ignored.push(i.key);
      CM.Store.save();
      this.analyzeNow();
      CM.Partner.say('Okay, I\'ll leave it.', { state: 'IDLE' });
    },

    why: function (i) {
      this.setView(this.m.wide() ? this.m.view : 'ai');
      CM.Chat.add('user', 'line ' + i.line + ' 왜 문제야?');
      var extra = { line: i.line, source: 'local' };
      if (i.confidence < 0.75) extra.uncertain = true;
      var d = CM.Analyzer.describeLine(this.m.file.content, i.line);
      CM.Chat.add('ai', (d ? '이 줄은 ' + d + ' ' : '') + i.message, extra);
    },

    // ---------- running ----------
    banner: function (kind, text) {
      var b = this.m.outBanner;
      b.className = 'run-banner ' + kind;
      b.textContent = text;
    },
    log: function (level, text) {
      var c = this.m.consoleEl;
      c.appendChild(el('div.cl.' + level, { text: text }));
      while (c.children.length > 400) c.removeChild(c.firstChild);
      c.scrollTop = c.scrollHeight;
      CM.Terminal.record(level, text);
    },

    run: function () {
      var m = this.m, self = this;
      if (!m) return;
      this.analyzeSoon.flush();
      CM.Store.saveNow();
      if (!m.wide()) this.setView('run');
      m.consoleEl.innerHTML = '';
      CM.Terminal.record('info', '$ run ' + m.project.name);
      this.banner('running', 'Running…');
      CM.Partner.say('Running...', { state: 'THINKING', interrupt: true });
      var htmlFile = m.project.files.filter(function (f) { return f.name === 'index.html'; })[0];
      var linked = [], re = /<script[^>]*\bsrc\s*=\s*["']\.?\/?([^"']+)["']/gi, mm;
      while (htmlFile && (mm = re.exec(htmlFile.content))) linked.push(mm[1]);
      // A JS file that index.html doesn't load (or a mission file) runs on its own.
      var solo = !!htmlFile && /\.js$/.test(m.file.name) && (/^mission\d+\.js$/.test(m.file.name) || linked.indexOf(m.file.name) < 0);
      if (solo) this.log('info', m.file.name + ' is not loaded by index.html, so it runs on its own.');
      this.outTab(htmlFile && !solo ? 'preview' : 'console');
      var reported = false;
      CM.Sandbox.run(m.project, m.preview, {
        only: solo ? m.file.name : null,
        onConsole: function (e) { if (self.m) self.log(e.level, e.text); },
        onDone: function (res) { if (self.m) self.afterRun(res); reported = !res.ok; },
        onLateError: function (err) {
          if (!self.m || reported) return;
          reported = true;
          self.log('error', err.name + ': ' + err.message + (err.file ? ' (' + err.file + ':' + err.line + ')' : ''));
          self.afterRun({ ok: false, error: err, errors: [err] });
        }
      });
    },

    afterRun: function (res) {
      var m = this.m, P = CM.Partner, Pr = CM.Progress, self = this;
      Pr.p.stats.runs++;
      if (res.ok) {
        Pr.p.stats.okRuns++;
        this.banner('ok', '✓ Program finished');
        m.project.lastRunOk = true;
        this.editor.setRuntimeLine(null);
        P.react('SUCCESS', 3500);
        P.say('Nice. It works.', { state: 'SUCCESS', interrupt: true });
        if (Pr.unlock('it_runs')) Pr.addXP(CM.CONFIG.XP.FIRST_RUN, 'First successful run', 'first_run');
        if (m.hadRunError && m.lastRunError) {
          if (Pr.addXP(CM.CONFIG.XP.RUNTIME_FIX, 'Runtime error fixed', m.project.id + ':rt:' + m.lastRunError.message)) { Pr.unlock('debugger'); Pr.skill('debugging', 2); }
        }
        m.hadRunError = false; m.lastRunError = null;
      } else {
        var err = res.error || { name: 'Error', message: 'Unknown error' };
        this.banner('err', (res.syntax ? '✕ Syntax error' : '✕ Runtime error') + ' — ' + err.name + ': ' + err.message + (err.file ? ' (' + err.file + (err.line ? ':' + err.line : '') + ')' : ''));
        if (res.syntax) this.log('error', 'SyntaxError: ' + err.message + ' (' + err.file + ':' + err.line + ')');
        m.project.lastRunOk = false;
        m.hadRunError = true; m.lastRunError = err;
        if (err.file && err.file === m.file.name && err.line) this.editor.setRuntimeLine(err.line);
        P.react('ERROR', 3500);
        P.say('...', { ms: 600, interrupt: true, state: 'ERROR' });
        CM.AIService.explainError(err, this.context()).then(function (ex) {
          if (!self.m) return;
          P.say(ex.title, { state: 'WARNING' });
          CM.Chat.add('ai', ex.text, { line: ex.line, file: ex.file, source: ex.source });
          if (!m.wide()) self.badge(1);
        });
      }
      CM.Store.save();
    },

    // ---------- missions ----------
    currentMission: function () {
      var m = this.m;
      if (!m || !m.file) return null;
      return CM.Content.MISSIONS.filter(function (x) { return x.file === m.file.name; })[0] || null;
    },

    pickMission: function () {
      var self = this, done = CM.Progress.p.missions;
      var opts = CM.Content.MISSIONS.map(function (ms, idx) {
        var prevDone = idx === 0 || (done[CM.Content.MISSIONS[idx - 1].id] || {}).done;
        var d = (done[ms.id] || {}).done;
        return { value: ms.id, label: (d ? '✓ ' : prevDone ? '' : '🔒 ') + 'MISSION ' + String(idx + 1).padStart(2, '0') + ' — ' + ms.title, desc: prevDone ? ms.goal : '이전 미션을 먼저 완료해줘.', disabled: !prevDone };
      });
      CM.UI.choose('Coding Missions', opts, '미션 파일이 이 프로젝트에 추가돼. CHECK로 채점해.').then(function (id) { if (id && self.m) self.startMission(id); });
    },

    startMission: function (id) {
      var ms = CM.Content.MISSIONS.filter(function (x) { return x.id === id; })[0];
      if (!ms) return;
      var p = this.m.project;
      if (!p.files.some(function (f) { return f.name === ms.file; })) {
        if (p.files.length >= CM.CONFIG.MAX_FILES) { CM.UI.toast('파일이 너무 많아서 미션 파일을 만들 수 없어.', 'warn'); return; }
        p.files.push({ name: ms.file, content: ms.starter });
        CM.Store.save();
        this.refreshFiles();
      }
      this.openFile(ms.file);
      this.setView('code');
      CM.Partner.say('Mission: ' + ms.title, { state: 'HAPPY', interrupt: true });
      CM.Chat.add('ai', ms.title + '\n' + ms.goal + '\n막히면 HINT를 눌러. 한 단계씩 알려줄게.');
    },

    updateMissionBar: function () {
      var m = this.m, ms = this.currentMission(), self = this;
      m.missionBar.innerHTML = '';
      m.missionBar.classList.toggle('hidden', !ms);
      if (!ms) return;
      var idx = CM.Content.MISSIONS.indexOf(ms) + 1, st = CM.Progress.p.missions[ms.id] || {};
      m.missionBar.appendChild(el('div.mb-text', {}, [el('strong', { text: (st.done ? '✓ ' : '') + 'MISSION ' + String(idx).padStart(2, '0') + ' · ' + ms.title }), el('span', { text: ms.goal })]));
      m.missionBar.appendChild(el('div.mb-actions', {}, [
        el('button.btn.small', { text: 'HINT', onclick: function () { self.hint(); } }),
        el('button.btn.small.primary', { text: 'CHECK', onclick: function () { self.check(); } })
      ]));
    },

    hint: function () {
      var ms = this.currentMission();
      if (!ms) { CM.Chat.add('ai', '지금 열린 파일은 미션 파일이 아니야. MISSION 버튼으로 미션을 시작해봐.'); return; }
      var st = CM.Progress.p.missions[ms.id] = CM.Progress.p.missions[ms.id] || { done: false, hints: 0 };
      var n = Math.min(st.hints, ms.hints.length - 1);
      CM.Chat.add('ai', 'HINT ' + (n + 1) + '/' + ms.hints.length + ': ' + ms.hints[n] + (n < ms.hints.length - 1 ? '\n(더 필요하면 HINT를 한 번 더 눌러.)' : ''));
      CM.Partner.say(n === 0 ? 'Here\'s a small hint.' : n < ms.hints.length - 1 ? 'A bit more help.' : 'Almost the answer.', { state: 'THINKING', interrupt: true });
      st.hints = Math.min(ms.hints.length, st.hints + 1);
      CM.Store.save();
      if (!this.m.wide()) this.setView('ai');
    },

    check: function () {
      var m = this.m, ms = this.currentMission(), self = this;
      if (!ms) return;
      this.analyzeSoon.flush();
      CM.Store.saveNow();
      m.consoleEl.innerHTML = '';
      this.banner('running', 'Checking mission…');
      CM.Partner.say('Let me check.', { state: 'THINKING', interrupt: true });
      CM.Sandbox.run(m.project, m.preview, {
        only: ms.file, test: ms.test, settleMs: 250,
        onConsole: function (e) { if (self.m) self.log(e.level, e.text); },
        onDone: function (res) {
          if (!self.m) return;
          if (!res.ok) { self.afterRun(res); return; }
          var t = res.test || { pass: false, message: '테스트 결과를 받지 못했어.' };
          var Pr = CM.Progress, st = Pr.p.missions[ms.id] = Pr.p.missions[ms.id] || { done: false, hints: 0 };
          if (t.pass) {
            self.banner('ok', '✓ Mission complete — ' + t.message);
            CM.Partner.react('SUCCESS', 3500);
            CM.Partner.say('Mission complete!', { state: 'SUCCESS', interrupt: true });
            if (!st.done) {
              st.done = true;
              Pr.addXP(CM.CONFIG.XP.MISSION, 'Mission complete', 'mission:' + ms.id);
              Pr.skill('logic', 3);
              Pr.unlock('first_mission');
              if (Pr.missionsDone() >= CM.Content.MISSIONS.length) Pr.unlock('all_missions');
            }
            var next = CM.Content.MISSIONS[CM.Content.MISSIONS.indexOf(ms) + 1];
            CM.Chat.add('ai', '해냈어! ' + t.message + (next ? '\n다음 미션: ' + next.title : '\n모든 미션 완료! 이제 자유롭게 게임을 만들어보자.'));
            self.updateMissionBar();
          } else {
            self.banner('err', '✕ Not yet — ' + t.message);
            CM.Partner.say('Not yet.', { state: 'THINKING', interrupt: true });
            CM.Chat.add('ai', '아직이야: ' + t.message + '\nHINT가 필요하면 눌러줘.');
          }
          CM.Store.save();
        }
      });
    },

    updateMode: function () {
      if (!this.m) return;
      this.m.modeLabel.textContent = CM.AIService.modeLabel;
      this.m.modeLabel.className = 'mode-label ' + (CM.AIService.online ? 'ok' : 'off');
    },

    // ---------- partner stage (side panel + floating mini partner) ----------
    drawStage: function (t) {
      var m = this.m;
      if (!m) return;
      [m.stage, m.mini].forEach(function (c) {
        if (!c.offsetParent) return;
        var r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
        if (!w || !h) return;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        var g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, r.width, r.height);
        var mini = c === m.mini;
        if (!mini) {
          var grd = g.createLinearGradient(0, 0, 0, r.height);
          grd.addColorStop(0, '#141b2b'); grd.addColorStop(1, '#0c111b');
          g.fillStyle = grd; g.fillRect(0, 0, r.width, r.height);
          g.fillStyle = 'rgba(108,196,255,0.08)'; g.fillRect(0, r.height - 26, r.width, 26);
        }
        var sc = mini ? Math.min(1.1, r.height / 72) : Math.min(1.6, r.height / 100);
        var px = mini ? r.width - 34 * sc : r.width * 0.24;
        CM.Partner.draw(g, px, r.height - (mini ? 6 : 16), sc, t, { facing: mini ? -1 : 1, bubble: false });
        var b = CM.Partner.bubble;
        if (b) {
          if (mini) CM.Partner.drawBubble(g, Math.max(70, px - 34 * sc - 60), r.height - 10, b.text, 0.95, Math.min(150, r.width - 80));
          else CM.Partner.drawBubble(g, r.width * 0.66, r.height * 0.82, b.text, 1, r.width * 0.5);
        }
      });
    }
  };

  CM.Phone.register(Lab);
  CM.CodeLab = Lab;
})(typeof self !== 'undefined' ? self : this);
