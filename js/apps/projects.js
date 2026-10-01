/* Projects app: create from templates, open, rename, delete, export/import, mark complete. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});
  var el = CM.util.el;

  var Projects = {
    id: 'projects', title: 'Projects',
    mount: function (container) { this.container = container; this.render(); },
    unmount: function () { this.container = null; },
    render: function () {
      var self = this, c = this.container, d = CM.Store.data;
      if (!c) return;
      c.innerHTML = '';
      var fileInput = el('input', { attrs: { type: 'file', accept: '.json,application/json', hidden: '' }, onchange: function () { self.importFile(fileInput); } });
      c.appendChild(el('div.app-head', {}, [
        el('div', {}, [el('h2', { text: 'Projects' }), el('p.muted', { text: d.projects.length + ' / ' + CM.CONFIG.MAX_PROJECTS + ' projects' })]),
        el('div.row-actions', {}, [
          el('button.btn', { text: 'IMPORT', onclick: function () { fileInput.click(); } }),
          el('button.btn.primary', { text: '+ NEW', onclick: function () { self.create(); } })
        ]), fileInput
      ]));
      var grid = el('div.cards');
      d.projects.slice().sort(function (a, b) { return b.updated - a.updated; }).forEach(function (p) {
        var current = p.id === d.currentProjectId;
        grid.appendChild(el('div.card' + (current ? '.current' : ''), {}, [
          el('div.card-h', {}, [el('strong', { text: p.name }), current ? el('span.tag', { text: 'OPEN' }) : null, p.completed ? el('span.tag.ok', { text: '✓ COMPLETE' }) : null]),
          el('p.muted', { text: p.files.length + ' files · ' + new Date(p.updated).toLocaleString() }),
          el('p.muted', { text: p.lastRunOk ? '마지막 실행: 성공 ✓' : '마지막 실행: 아직 성공하지 못함' }),
          el('div.row-actions', {}, [
            el('button.btn.small.primary', { text: 'OPEN', onclick: function () { self.open(p); } }),
            el('button.btn.small', { text: 'RENAME', onclick: function () { self.rename(p); } }),
            el('button.btn.small', { text: 'EXPORT', onclick: function () { self.exportP(p); } }),
            el('button.btn.small', { text: p.completed ? 'COMPLETED' : 'MARK COMPLETE', disabled: p.completed || !p.lastRunOk, title: p.lastRunOk ? '' : 'Run it successfully first', onclick: function () { self.complete(p); } }),
            el('button.btn.small.danger', { text: 'DELETE', disabled: d.projects.length <= 1, onclick: function () { self.remove(p); } })
          ])
        ]));
      });
      c.appendChild(grid);
    },
    open: function (p) {
      CM.Store.data.currentProjectId = p.id;
      CM.Store.save();
      CM.Partner.say('Opening ' + p.name + '.', { state: 'HAPPY' });
      CM.Phone.open('codelab');
    },
    create: function () {
      var self = this, d = CM.Store.data;
      if (d.projects.length >= CM.CONFIG.MAX_PROJECTS) { CM.UI.toast('프로젝트가 너무 많아. 하나를 지워줘.', 'warn'); return; }
      var T = CM.Content.TEMPLATES;
      CM.UI.choose('New project', Object.keys(T).map(function (k) { return { value: k, label: T[k].name, desc: T[k].desc }; })).then(function (tid) {
        if (!tid) return;
        return CM.UI.prompt('Project name', T[tid].name, '', function (v) { return v && v.length <= 40 ? null : '1~40자로 입력해줘.'; }).then(function (name) {
          if (!name) return;
          var p = CM.Store.makeProject(tid, name);
          d.projects.push(p);
          d.currentProjectId = p.id;
          CM.Store.save();
          CM.UI.toast('Project created.', 'ok');
          self.render();
        });
      });
    },
    rename: function (p) {
      var self = this;
      CM.UI.prompt('Rename project', p.name, '', function (v) { return v && v.length <= 40 ? null : '1~40자로 입력해줘.'; }).then(function (name) {
        if (!name) return; p.name = name; p.updated = Date.now(); CM.Store.save(); self.render();
      });
    },
    remove: function (p) {
      var self = this, d = CM.Store.data;
      if (d.projects.length <= 1) return;
      CM.UI.confirm('Delete "' + p.name + '"?', '모든 파일이 삭제되고 되돌릴 수 없어. 필요하면 먼저 EXPORT 해둬.', 'DELETE', true).then(function (ok) {
        if (!ok) return;
        d.projects = d.projects.filter(function (x) { return x !== p; });
        if (d.currentProjectId === p.id) d.currentProjectId = d.projects[0].id;
        CM.Store.save(); self.render();
      });
    },
    exportP: function (p) {
      try {
        var blob = new Blob([CM.Store.exportProject(p)], { type: 'application/json' });
        var a = el('a', { href: URL.createObjectURL(blob), download: p.name.replace(/[^\w-]+/g, '_') + '.codemate.json' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        CM.UI.toast('Exported.', 'ok');
      } catch (e) { CM.reportError(e, 'export'); }
    },
    importFile: function (input) {
      var self = this, f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 2e6) { CM.UI.toast('파일이 너무 커.', 'warn'); return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          var p = CM.Store.importProject(String(r.result));
          if (CM.Store.data.projects.length >= CM.CONFIG.MAX_PROJECTS) throw new Error('too many projects');
          CM.Store.data.projects.push(p); CM.Store.save(); self.render();
          CM.UI.toast('Imported "' + p.name + '".', 'ok');
        } catch (e) {
          console.warn('[CODEMATE] import failed', e);
          CM.UI.toast('프로젝트 파일을 읽을 수 없어. CODEMATE에서 EXPORT한 .json 파일인지 확인해줘.', 'error', 4000);
        }
        input.value = '';
      };
      r.onerror = function () { CM.UI.toast('파일을 읽지 못했어. 다시 시도해줘.', 'error'); };
      r.readAsText(f);
    },
    complete: function (p) {
      if (!p.lastRunOk || p.completed) return;
      var self = this;
      CM.UI.confirm('Mark "' + p.name + '" complete?', '완성된 프로젝트로 기록할게.', 'COMPLETE').then(function (ok) {
        if (!ok) return;
        p.completed = true;
        CM.Progress.addXP(CM.CONFIG.XP.PROJECT, 'Project complete', 'project:' + p.id);
        CM.Progress.unlock('builder');
        CM.Partner.react('SUCCESS', 4000);
        CM.Partner.say('We actually built this.', { state: 'SUCCESS', interrupt: true });
        CM.Store.save(); self.render();
      });
    }
  };

  CM.Phone.register(Projects);
})(typeof self !== 'undefined' ? self : this);
