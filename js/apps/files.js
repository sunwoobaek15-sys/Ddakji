/* Files app: browse, create, rename and delete files of the current project. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  function validName(p, current) {
    return function (v) {
      if (!CM.Store.FILE_RE.test(v)) return '영문, 숫자, . - _ 만 쓸 수 있어. 예: enemy.js';
      if (!/\.(js|html|css|txt|md|json)$/.test(v)) return '.js .html .css .txt .md .json 파일만 가능해.';
      if (v !== current && p.files.some(function (f) { return f.name === v; })) return '같은 이름의 파일이 이미 있어.';
      return null;
    };
  }

  var Files = {
    id: 'files', title: 'Files',
    mount: function (container) { this.container = container; this.render(); },
    unmount: function () { this.container = null; },
    render: function () {
      var self = this, c = this.container, p = CM.Store.project();
      if (!c) return;
      c.innerHTML = '';
      var head = el('div.app-head', {}, [
        el('div', {}, [el('h2', { text: p.name }), el('p.muted', { text: p.files.length + ' files · 모든 파일은 자동 저장돼.' })]),
        el('button.btn.primary', { text: '+ NEW FILE', onclick: function () { self.create(); } })
      ]);
      var list = el('div.list');
      p.files.forEach(function (f) {
        var lang = CM.Analyzer.languageOf(f.name);
        var res = CM.Analyzer.analyze(f.content, { fileName: f.name, isMission: true });
        var errs = res.issues.filter(function (i) { return i.severity === 'error'; }).length;
        list.appendChild(el('div.row', {}, [
          el('span.ficon.' + lang, { text: { js: 'JS', html: '<>', css: '#', text: '¶' }[lang] }),
          el('div.row-main', {}, [el('strong', { text: f.name }), el('span.muted', { text: f.content.split('\n').length + ' lines · ' + f.content.length + ' chars' + (errs ? ' · ' : '') }, errs ? [el('span.err-text', { text: errs + ' error' + (errs > 1 ? 's' : '') })] : [])]),
          el('div.row-actions', {}, [
            el('button.btn.small.primary', { text: 'OPEN', onclick: function () { CM.Phone.open('codelab', { file: f.name }); } }),
            el('button.btn.small', { text: 'RENAME', onclick: function () { self.rename(f); } }),
            el('button.btn.small.danger', { text: 'DELETE', disabled: p.files.length <= 1, onclick: function () { self.remove(f); } })
          ])
        ]));
      });
      c.appendChild(head);
      c.appendChild(list);
    },
    create: function () {
      var self = this, p = CM.Store.project();
      if (p.files.length >= CM.CONFIG.MAX_FILES) { CM.UI.toast('파일은 최대 ' + CM.CONFIG.MAX_FILES + '개야.', 'warn'); return; }
      CM.UI.prompt('New file', '', 'enemy.js', validName(p)).then(function (name) {
        if (!name) return;
        p.files.push({ name: name, content: /\.js$/.test(name) ? '// ' + name + '\n' : '' });
        p.updated = Date.now(); CM.Store.save(); self.render();
        CM.UI.toast(name + ' created.', 'ok');
      });
    },
    rename: function (f) {
      var self = this, p = CM.Store.project();
      CM.UI.prompt('Rename ' + f.name, f.name, '', validName(p, f.name)).then(function (name) {
        if (!name || name === f.name) return;
        var old = f.name;
        f.name = name;
        if (p.activeFile === old) p.activeFile = name;
        p.updated = Date.now(); CM.Store.save(); self.render();
        var html = p.files.filter(function (x) { return x.name === 'index.html'; })[0];
        CM.UI.toast(html && html.content.indexOf(old) >= 0 ? 'Renamed. index.html still mentions "' + old + '" — update it too.' : 'Renamed.', html && html.content.indexOf(old) >= 0 ? 'warn' : 'ok', 4000);
      });
    },
    remove: function (f) {
      var self = this, p = CM.Store.project();
      if (p.files.length <= 1) return;
      CM.UI.confirm('Delete ' + f.name + '?', '이 파일은 되돌릴 수 없어.', 'DELETE', true).then(function (ok) {
        if (!ok) return;
        p.files = p.files.filter(function (x) { return x !== f; });
        if (p.activeFile === f.name) p.activeFile = p.files[0].name;
        p.updated = Date.now(); CM.Store.save(); self.render();
        CM.UI.toast(f.name + ' deleted.', 'info');
      });
    }
  };

  CM.Phone.register(Files);
})(typeof self !== 'undefined' ? self : this);
