'use strict';
// Unit tests for the offline analyzer (node --test).
const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/analyzer.js');

const run = (code, opts) => A.analyze(code, Object.assign({ fileName: 'game.js' }, opts || {}));
const find = (res, type) => res.issues.find((i) => i.type === type);

test('typo in an identifier is detected with a fix', () => {
  const r = run('const player = { x: 0 };\nplyaer.x = 5;\nconsole.log(player);');
  const t = find(r, 'TYPO');
  assert.ok(t, 'typo found');
  assert.strictEqual(t.word, 'plyaer');
  assert.strictEqual(t.suggestion, 'player');
  assert.strictEqual(t.line, 2);
  const fixed = A.applyEdits(r.code || 'const player = { x: 0 };\nplyaer.x = 5;\nconsole.log(player);', t.fix.edits);
  assert.ok(/^player\.x = 5;$/m.test(fixed));
});

test('getElementById("plyaer") suggests the id from index.html', () => {
  const r = run('const player = document.getElementById("plyaer");\nplayer.textContent = "hi";', { htmlIds: ['player', 'score'] });
  const t = find(r, 'TYPO');
  assert.ok(t);
  assert.strictEqual(t.suggestion, 'player');
  assert.match(t.fix.after, /getElementById\("player"\)/);
});

test('keyword typo (fucntion) is reported as a typo with a confident fix', () => {
  const r = run('fucntion move() {\n  return 1;\n}\nmove();');
  const t = find(r, 'TYPO');
  assert.ok(t);
  assert.strictEqual(t.suggestion, 'function');
  assert.ok(t.confidence >= 0.9);
});

test('syntax errors: unclosed brace, unclosed quote, bad token', () => {
  assert.ok(find(run('function a() {\n  if (x) {\n    console.log(1);\n}\n'), 'SYNTAX_ERROR'));
  const q = find(run('let s = "abc;\nconsole.log(s);'), 'SYNTAX_ERROR');
  assert.ok(q && q.fix);
  assert.strictEqual(q.line, 1);
  const p = find(run('let a = 1\nlet b = a +* 2;'), 'SYNTAX_ERROR');
  assert.ok(p);
  assert.strictEqual(p.line, 2);
});

test('unused variable gets a REMOVE fix that deletes the whole line', () => {
  const code = 'const test = 123;\nconsole.log("hi");\n';
  const r = run(code);
  const u = find(r, 'UNUSED_VARIABLE');
  assert.ok(u);
  assert.strictEqual(u.fix.kind, 'REMOVE');
  assert.strictEqual(A.applyEdits(code, u.fix.edits), 'console.log("hi");\n');
});

test('ignored keys (KEEP) are not reported again', () => {
  const r = run('const test = 123;', { ignored: ['unused:test'] });
  assert.strictEqual(find(r, 'UNUSED_VARIABLE'), undefined);
});

test('top-level names used by other project files are not "unused"', () => {
  const r = run('const player = { x: 1 };', { projectUsages: ['player'] });
  assert.strictEqual(find(r, 'UNUSED_VARIABLE'), undefined);
});

test('globals declared in other project files are not "undeclared"', () => {
  const r = run('drawPlayer(ctx);', { projectGlobals: ['drawPlayer', 'ctx'] });
  assert.strictEqual(r.issues.filter((i) => i.severity === 'error').length, 0);
});

test('repeated lines suggest a function (movePlayer) and the result still parses', () => {
  const code = 'const player = { x: 0 };\nplayer.x += 10;\nplayer.x += 10;\nplayer.x += 10;\n';
  const r = run(code);
  const d = find(r, 'DUPLICATED_CODE');
  assert.ok(d);
  const after = A.applyEdits(code, d.fix.edits);
  assert.match(after, /function movePlayer\(amount\)/);
  assert.match(after, /movePlayer\(30\);/);
  assert.ok(A.checkSyntax(after).ok);
});

test('use before declaration (TDZ) is explained', () => {
  const r = run('console.log(playerSpeed);\nlet playerSpeed = 5;');
  const b = r.issues.find((i) => i.key === 'tdz:playerSpeed');
  assert.ok(b);
  assert.match(b.message, /playerSpeed 변수를 만들기 전에 사용하고 있어/);
});

test('possible bugs: const reassign, assignment in if, infinite loop, <= length', () => {
  const r = run('const a = 1;\na = 2;\nif (a = 3) {}\nconst arr = [1];\nfor (let i = 0; i <= arr.length; i++) {}\nwhile (true) { }');
  const keys = r.issues.map((i) => i.key.split(':')[0]);
  ['constwrite', 'assigncond', 'offbyone', 'infinite'].forEach((k) => assert.ok(keys.includes(k), k));
});

test('member typos: console.lgo and .lenght', () => {
  const r = run('console.lgo("hi");\nconst arr = [1];\nconsole.log(arr.lenght);');
  const typos = r.issues.filter((i) => i.type === 'TYPO').map((i) => i.suggestion);
  assert.ok(typos.includes('log'));
  assert.ok(typos.includes('length'));
});

test('empty functions are noted; mission files skip unused top-level checks', () => {
  const r = run('function movePlayer(dx, dy) {\n}\n', { isMission: true });
  assert.ok(r.issues.find((i) => i.key === 'empty:movePlayer'));
  assert.strictEqual(find(r, 'UNUSED_VARIABLE'), undefined);
});

test('clean code reports GOOD_CODE', () => {
  const r = run('const player = { x: 0 };\nfunction move(dx) {\n  player.x += dx;\n}\nmove(5);\nconsole.log(player.x);\n');
  assert.strictEqual(r.issues.length, 0);
  assert.strictEqual(r.summary, 'GOOD_CODE');
});

test('HTML: missing script file suggests the closest project file', () => {
  const r = A.analyze('<html><body><script src="gmae.js"></script></body></html>', { fileName: 'index.html', fileNames: ['index.html', 'game.js'] });
  const t = find(r, 'TYPO');
  assert.ok(t);
  assert.strictEqual(t.suggestion, 'game.js');
});

test('CSS: property typo and missing semicolon', () => {
  const r = A.analyze('body {\n  colr: red;\n  margin: 0\n  padding: 4px;\n}\n', { fileName: 'style.css' });
  assert.ok(r.issues.find((i) => i.type === 'TYPO' && i.suggestion === 'color'));
  assert.ok(r.issues.find((i) => i.key.startsWith('css:semi')));
});

test('loop instrumentation keeps code valid and inserts guards', () => {
  const out = A.instrumentLoops('for (let i = 0; i < 3; i++) x++;\nwhile (a) { b(); }', '__g');
  assert.ok(A.checkSyntax(out).ok);
  assert.strictEqual((out.match(/__g\(\)/g) || []).length, 2);
});

test('analysis is fast enough for live typing (< 50ms for ~300 lines)', () => {
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(`function f${i}(a) {`, `  return a + ${i};`, '}');
  lines.push('console.log(f1(1));');
  const r = run(lines.join('\n'));
  assert.ok(r.ms < 50, 'took ' + r.ms + 'ms');
});
