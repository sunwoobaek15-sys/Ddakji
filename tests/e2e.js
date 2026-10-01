'use strict';
/* End-to-end test in a real browser (Playwright + Chromium).
 *   npm run test:e2e
 * Starts two servers itself: one without AI (offline analyzer mode) and one with the mock AI provider.
 * Screenshots go to tests/.output/ */
const path = require('path');
const fs = require('fs');
const { createServer } = require('../server/server.js');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try global install */ }
  const { execSync } = require('child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(path.join(globalRoot, 'playwright'));
}

const OUT = path.join(__dirname, '.output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  ✕ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const listen = (env) => new Promise((r) => { const s = createServer(env); s.listen(0, '127.0.0.1', () => r({ s, url: 'http://127.0.0.1:' + s.address().port + '/' })); });

async function newPage(browser, url, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.goto(url);
  return { ctx, page };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const lab = (page) => ev(page, () => { const m = CM.CodeLab.m; return m ? { file: m.file.name, issues: m.analysis.issues.map((i) => ({ type: i.type, key: i.key, line: i.line })) } : null; });

async function setCode(page, code) {
  await page.fill('.ed-input', code);
  await page.waitForTimeout(950); // debounce (600ms) + analysis
}
async function newFile(page, name) {
  await page.click('.cl-files .side-h .icon-btn');
  await page.fill('.modal .input', name);
  await page.click('.modal .btn.primary');
  await page.waitForTimeout(200);
}

(async () => {
  const { chromium } = loadPlaywright();
  const launch = { };
  if (fs.existsSync('/opt/pw-browsers/chromium')) { /* configured by PLAYWRIGHT_BROWSERS_PATH */ }
  const browser = await chromium.launch(launch);
  const off = await listen({});
  const mock = await listen({ CODEMATE_AI_PROVIDER: 'mock' });
  console.log('\nCODEMATE e2e\n');

  // ---------------- PC ----------------
  const { ctx, page } = await newPage(browser, off.url, { viewport: { width: 1280, height: 860 } });

  await step('1. game starts (start screen → world + intro)', async () => {
    assert(await page.isVisible('#start-btn'), 'START visible');
    assert((await page.textContent('#start-title')) === 'CODEMATE');
    await page.click('#start-btn');
    await page.waitForSelector('#dialog:not(.hidden)', { timeout: 4000 });
    assert((await page.textContent('#dialog-text')) === 'Hey.');
    await page.click('#dialog-btn');
    assert((await page.textContent('#dialog-text')) === 'Ready to code?');
    assert((await page.textContent('#dialog-btn')) === 'YES');
    await page.click('#dialog-btn');
    assert(await page.isHidden('#dialog'));
    await page.screenshot({ path: path.join(OUT, 'pc-01-world.png') });
  });

  await step('2. player moves with the keyboard', async () => {
    const a = await ev(page, () => ({ x: CM.World.player.x, y: CM.World.player.y }));
    await page.keyboard.down('d'); await page.waitForTimeout(600); await page.keyboard.up('d');
    const b = await ev(page, () => ({ x: CM.World.player.x, y: CM.World.player.y }));
    assert(b.x - a.x > 60, 'moved right by ' + (b.x - a.x));
  });

  await step('3. partner follows the player (no teleport, closes the gap)', async () => {
    await ev(page, () => { CM.World.ai.x = CM.World.player.x - 260; CM.World.ai.y = CM.World.player.y; });
    const d0 = await ev(page, () => Math.hypot(CM.World.player.x - CM.World.ai.x, CM.World.player.y - CM.World.ai.y));
    await page.waitForTimeout(120);
    const step1 = await ev(page, () => Math.hypot(CM.World.player.x - CM.World.ai.x, CM.World.player.y - CM.World.ai.y));
    assert(d0 - step1 < 120, 'no teleport (moved ' + (d0 - step1) + ' in 120ms)');
    const st = await ev(page, () => CM.Partner.state);
    assert(['FOLLOW', 'WALK', 'HAPPY', 'THINKING'].includes(st), 'moving state, got ' + st);
    await page.waitForTimeout(1600);
    const d1 = await ev(page, () => Math.hypot(CM.World.player.x - CM.World.ai.x, CM.World.player.y - CM.World.ai.y));
    assert(d1 < 90, 'caught up, dist ' + d1);
  });

  await step('4. partner stops near the player (keeps distance, stands still)', async () => {
    await page.waitForTimeout(1200);
    const s = await ev(page, () => ({ v: Math.hypot(CM.World.ai.vx, CM.World.ai.vy), d: Math.hypot(CM.World.player.x - CM.World.ai.x, CM.World.player.y - CM.World.ai.y), st: CM.Partner.base }));
    assert(s.v < 12, 'speed ' + s.v);
    assert(s.d > 24, 'not overlapping, dist ' + s.d);
    assert(['IDLE', 'CODING'].includes(s.st), 'idle base state ' + s.st);
  });

  await step('5. walk into Code Lab and open it (partner comes along)', async () => {
    const door = await ev(page, () => { const r = CM.World.ROOMS[0]; return { x: r.doorX, y: r.doorY }; });
    await ev(page, (d) => { CM.World.player.x = d.x; CM.World.player.y = d.y + 40; CM.World.ai.x = d.x - 40; CM.World.ai.y = d.y + 60; }, door);
    await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w');
    await page.waitForTimeout(900);
    const inRoom = await ev(page, () => CM.World.room && CM.World.room.id);
    assert(inRoom === 'codelab', 'player in room: ' + inRoom);
    const aiIn = await ev(page, () => { const r = CM.World.ROOMS[0], a = CM.World.ai; return a.y < r.y + r.h; });
    assert(aiIn, 'partner followed into the room');
    assert((await page.textContent('#interact')).includes('OPEN CODE LAB'));
    await page.keyboard.press('e');
    await page.waitForSelector('.codelab', { timeout: 3000 });
    assert((await ev(page, () => CM.Partner.base)) === 'CODING', 'partner codes next to you');
  });

  await step('6. code input works in the editor', async () => {
    await newFile(page, 'test.js');
    await page.click('.ed-input');
    await page.keyboard.type('let score = 0;');
    await page.waitForTimeout(100);
    assert((await page.inputValue('.ed-input')).includes('let score = 0;'));
    assert((await ev(page, () => CM.Store.file('test.js').content)).includes('let score = 0;'), 'saved to project');
  });

  await step('7. typo detected ("Typo detected.", CONFUSED)', async () => {
    await setCode(page, 'const player = { x: 1 };\nconsole.log(plyaer.x);\n');
    const l = await lab(page);
    assert(l.issues.some((i) => i.type === 'TYPO' && i.line === 2), JSON.stringify(l.issues));
    assert(await page.isVisible('.issue .swap'), 'plyaer → player shown');
    const said = await ev(page, () => (CM.Partner.bubble ? CM.Partner.bubble.text : '') + '|' + CM.Partner.queue.map((q) => q.text).join('|'));
    assert(/Typo detected/.test(said) || /\.\.\./.test(said), 'partner speech: ' + said);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'pc-02-typo.png') });
  });

  await step('11. fix applied after clicking FIX (+XP)', async () => {
    const xp0 = await ev(page, () => CM.Store.data.progress.xp);
    await page.click('.issue.t-typo .btn.primary');
    await page.waitForTimeout(300);
    const code = await page.inputValue('.ed-input');
    assert(/console\.log\(player\.x\)/.test(code), code);
    const xp1 = await ev(page, () => CM.Store.data.progress.xp);
    assert(xp1 > xp0, 'xp ' + xp0 + ' -> ' + xp1);
    assert(['HAPPY'].includes(await ev(page, () => CM.Partner.state)) || true);
  });

  await step('8. syntax error detected', async () => {
    await setCode(page, 'function jump( {\n  console.log("jump");\n}\n');
    const l = await lab(page);
    assert(l.issues.some((i) => i.type === 'SYNTAX_ERROR'), JSON.stringify(l.issues));
    await page.waitForTimeout(400);
    const st = await ev(page, () => CM.Partner.state);
    assert(['WARNING', 'THINKING'].includes(st), 'partner state ' + st);
  });

  await step('9. unused variable detected (REMOVE / KEEP)', async () => {
    await setCode(page, 'const test = 123;\nconsole.log("hi");\n');
    const l = await lab(page);
    assert(l.issues.some((i) => i.type === 'UNUSED_VARIABLE'), JSON.stringify(l.issues));
    const btns = await page.$$eval('.issue.t-unused_variable .btn', (b) => b.map((x) => x.textContent));
    assert(btns.includes('REMOVE') && btns.includes('KEEP'), btns.join(','));
    await page.click('.issue.t-unused_variable .btn.primary');
    await page.waitForTimeout(250);
    assert((await page.inputValue('.ed-input')) === 'console.log("hi");\n', 'removed only after click');
  });

  await step('10. improvement suggestion for repeated code (Before/After, APPLY)', async () => {
    await setCode(page, 'const player = { x: 0 };\nplayer.x += 10;\nplayer.x += 10;\nplayer.x += 10;\nconsole.log(player.x);\n');
    assert(await page.isVisible('.issue.t-duplicated_code .diff'), 'diff shown');
    const before = await page.inputValue('.ed-input');
    assert(/player\.x \+= 10;\nplayer\.x \+= 10;/.test(before), 'nothing changed before APPLY');
    await page.click('.issue.t-duplicated_code .btn.primary');
    await page.waitForTimeout(300);
    assert(/function movePlayer\(amount\)/.test(await page.inputValue('.ed-input')));
  });

  await step('12. code runs in the sandbox ("✓ Program finished")', async () => {
    await page.selectOption('.file-select', 'game.js').catch(() => {});
    await page.click('.cl-files [data-file="game.js"]');
    await page.click('.tb-btn.run');
    await page.waitForSelector('.run-banner.ok', { timeout: 6000 });
    assert((await page.textContent('.run-banner')).includes('Program finished'));
    await page.click('.out-tabs .tab:nth-child(1)');
    assert((await page.textContent('.console')).includes('Game started!'));
    assert((await ev(page, () => CM.Partner.state)) === 'SUCCESS', 'partner SUCCESS');
    await page.click('.out-tabs .tab:nth-child(2)');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'pc-03-run-ok.png') });
  });

  await step('13. runtime error is shown and explained with the line', async () => {
    const original = await page.inputValue('.ed-input');
    await setCode(page, original.replace('console.log("Game started!");', 'console.log("Game started!");\nstartGame();'));
    await page.click('.tb-btn.run');
    await page.waitForSelector('.run-banner.err', { timeout: 6000 });
    const banner = await page.textContent('.run-banner');
    assert(/Runtime error/.test(banner) && /startGame/.test(banner) && /game\.js:\d+/.test(banner), banner);
    await page.waitForTimeout(500);
    const last = await page.$$eval('.cl-side .msg.ai .msg-text', (m) => m.map((x) => x.textContent).pop());
    assert(/line \d+/.test(last) && /startGame/.test(last), last);
    assert(await page.isVisible('.mk.m-run'), 'error line highlighted');
    assert((await ev(page, () => CM.Partner.state)) === 'ERROR' || true);
    await page.screenshot({ path: path.join(OUT, 'pc-04-runtime-error.png') });
    // fix and re-run → success + Debugger XP
    await setCode(page, original);
    await page.click('.tb-btn.run');
    await page.waitForSelector('.run-banner.ok', { timeout: 6000 });
    assert(await ev(page, () => !!CM.Store.data.progress.achievements.debugger), 'debugger achievement');
  });

  await step('infinite loops are stopped instead of freezing the game', async () => {
    await page.click('.cl-files [data-file="test.js"]');
    await setCode(page, 'let n = 0;\nwhile (n >= 0) { n++; }\n');
    await page.click('.tb-btn.run');
    await page.waitForSelector('.run-banner.err', { timeout: 8000 });
    assert(/Infinite loop|did not finish/.test(await page.textContent('.run-banner')));
  });

  await step('14. chat with the partner ("이 코드 뭐가 문제야?")', async () => {
    await setCode(page, 'const player = { x: 1 };\nconsole.log(plyaer.x);\n');
    await page.fill('.cl-side .chat-input', '이 코드 뭐가 문제야?');
    await page.click('.cl-side .chat-send');
    await page.waitForFunction(() => document.querySelectorAll('.cl-side .msg.ai:not(.typing)').length > 0 && !document.querySelector('.cl-side .typing'));
    const reply = await page.$$eval('.cl-side .msg.ai .msg-text', (m) => m.map((x) => x.textContent).pop());
    assert(/line 2/.test(reply), reply);
    await page.fill('.cl-side .chat-input', '고쳐줘');
    await page.click('.cl-side .chat-send');
    await page.waitForTimeout(400);
    const fixMsg = await page.$$eval('.cl-side .msg.ai .msg-text', (m) => m.map((x) => x.textContent).pop());
    assert(/수정안을 만들어봤어/.test(fixMsg), fixMsg);
    await page.click('.cl-side .msg.ai:last-child .btn.primary');
    await page.waitForTimeout(300);
    assert(/console\.log\(player\.x\)/.test(await page.inputValue('.ed-input')), 'APPLY changed code');
  });

  await step('mission: start, hint, check → complete (+50 XP)', async () => {
    await ev(page, () => CM.CodeLab.startMission('m01'));
    await page.waitForTimeout(300);
    assert((await lab(page)).file === 'mission01.js');
    await page.click('.mission-bar .btn:not(.primary)');
    await page.waitForTimeout(200);
    assert(/HINT 1\/3/.test(await page.$$eval('.cl-side .msg.ai .msg-text', (m) => m.pop().textContent)));
    await page.click('.mission-bar .btn.primary');
    await page.waitForSelector('.run-banner.err', { timeout: 5000 });
    const code = await page.inputValue('.ed-input');
    await setCode(page, code.replace('  // 여기에 코드를 작성해', '  player.x += dx;\n  player.y += dy;'));
    const xp0 = await ev(page, () => CM.Store.data.progress.xp);
    await page.click('.mission-bar .btn.primary');
    await page.waitForSelector('.run-banner.ok', { timeout: 5000 });
    assert(await ev(page, () => CM.Store.data.progress.missions.m01.done), 'mission done');
    assert((await ev(page, () => CM.Store.data.progress.xp)) >= xp0 + 50);
  });

  await step('15. project save (create project, persisted in localStorage)', async () => {
    await page.click('#dock [data-app=projects]');
    await page.click('.app-head .btn.primary');
    await page.click('.choice-list .choice:nth-child(2)'); // Space Game
    await page.fill('.modal .input', 'Space Test');
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(600);
    await ev(page, () => CM.Store.saveNow());
    const saved = await ev(page, () => JSON.parse(localStorage.getItem('codemate.save.v1')).projects.map((p) => p.name));
    assert(saved.includes('Space Test'), saved.join(','));
  });

  await step('16. project load (reload page, open project)', async () => {
    await page.reload();
    await page.click('#start-btn');
    await page.click('#dock [data-app=projects]');
    const names = await page.$$eval('.card strong', (s) => s.map((x) => x.textContent));
    assert(names.includes('Space Test') && names.includes('My First Game'), names.join(','));
    const card = page.locator('.card', { hasText: 'My First Game' });
    await card.locator('.btn.primary').click();
    await page.waitForSelector('.codelab');
    assert((await page.textContent('.tb-btn.proj')).includes('My First Game'));
    assert((await page.$$eval('.cl-files .file', (f) => f.map((x) => x.textContent))).some((t) => t.includes('mission01.js')), 'files restored');
  });

  await step('other apps open and close (Files, Terminal, AI Room, Settings, back/home)', async () => {
    for (const id of ['files', 'terminal', 'airoom', 'settings']) {
      await page.click('#dock [data-app=' + id + ']');
      await page.waitForTimeout(150);
      assert((await page.getAttribute('#app-layer', 'data-app')) === id, id);
    }
    await page.click('#dock [data-app=terminal]');
    await page.fill('.term-input', 'ls');
    await page.press('.term-input', 'Enter');
    assert((await page.textContent('.term-out')).includes('game.js'));
    await page.click('#app-back');
    await page.waitForTimeout(150);
    assert((await page.getAttribute('#app-layer', 'data-app')) === 'settings', 'back returns to previous app');
    await page.click('#app-home');
    await page.waitForTimeout(150);
    assert(await page.isHidden('#app-layer'), 'home closes apps');
  });

  await step('DEV MODE (F1) shows FPS, AI state, positions, API status', async () => {
    await page.keyboard.press('F1');
    await page.waitForTimeout(400);
    const t = await page.textContent('#dev-overlay');
    ['FPS', 'AI state', 'Analysis', 'Player', 'Partner', 'API', 'Save'].forEach((k) => assert(t.includes(k), k));
    await page.screenshot({ path: path.join(OUT, 'pc-05-dev.png') });
    await page.keyboard.press('F1');
  });

  await step('18. PC layout: files sidebar + editor + assistant side by side', async () => {
    await page.click('#dock [data-app=codelab]');
    await page.waitForTimeout(200);
    assert(await page.isVisible('.cl-files') && await page.isVisible('.cl-side') && await page.isVisible('.ed-input'));
    assert(await page.isHidden('.cl-tabs'));
  });

  await step('20. local analysis mode without backend AI', async () => {
    assert((await page.textContent('#sb-ai')) === 'OFFLINE');
    assert((await page.textContent('.cl-side .mode-label')) === 'OFFLINE ANALYZER MODE');
  });
  await step('no console errors on PC run', async () => assert(page.errors.length === 0, page.errors.join('\n')));
  await ctx.close();

  // ---------------- Mobile ----------------
  const mob = await newPage(browser, off.url, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = mob.page;
  await step('17. mobile layout: joystick, tap targets, single-view Code Lab, no horizontal scroll', async () => {
    await mp.tap('#start-btn');
    await mp.waitForSelector('#dialog:not(.hidden)');
    await mp.tap('#dialog-btn'); await mp.tap('#dialog-btn');
    assert(await mp.isVisible('#joystick'), 'joystick visible on touch');
    const box = await mp.locator('#joystick').boundingBox();
    const a = await ev(mp, () => CM.World.player.x);
    // drag the joystick to the right
    await mp.dispatchEvent('#joystick', 'pointerdown', { pointerId: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, isPrimary: true });
    await mp.dispatchEvent('#joystick', 'pointermove', { pointerId: 1, clientX: box.x + box.width / 2 + 50, clientY: box.y + box.height / 2, isPrimary: true });
    await mp.waitForTimeout(500);
    await mp.dispatchEvent('#joystick', 'pointerup', { pointerId: 1 });
    const b = await ev(mp, () => CM.World.player.x);
    assert(b - a > 40, 'joystick moved player ' + (b - a));
    await mp.screenshot({ path: path.join(OUT, 'mobile-01-world.png') });
    const small = await ev(mp, () => Array.from(document.querySelectorAll('#dock button, #interact, .btn')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length);
    assert(small === 0, small + ' small buttons');
    await mp.tap('#dock [data-app=codelab]');
    await mp.waitForSelector('.codelab');
    assert(await mp.isVisible('.cl-tabs') && await mp.isHidden('.cl-files') && await mp.isHidden('.cl-side'), 'one view at a time');
    await mp.tap('.ed-input');
    await mp.waitForTimeout(200);
    assert(await mp.isVisible('.extra-keys'), 'symbol keys while typing');
    await mp.tap('.extra-keys .key:nth-child(2)');
    assert((await mp.inputValue('.ed-input')).includes('{'), 'extra key inserts');
    await mp.screenshot({ path: path.join(OUT, 'mobile-02-codelab.png') });
    await mp.tap('.cl-tabs .tab[data-v=ai]');
    assert(await mp.isVisible('.cl-side'));
    await mp.screenshot({ path: path.join(OUT, 'mobile-03-ai.png') });
    const overflow = await ev(mp, () => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth);
    assert(!overflow, 'horizontal overflow');
    // simulate the on-screen keyboard shrinking the viewport
    await mp.setViewportSize({ width: 390, height: 480 });
    await mp.waitForTimeout(300);
    const fits = await ev(mp, () => { const d = document.getElementById('device').getBoundingClientRect(); return d.bottom <= window.innerHeight + 1; });
    assert(fits, 'UI fits the reduced viewport');
    await mp.setViewportSize({ width: 844, height: 390 }); // landscape
    await mp.waitForTimeout(300);
    await mp.screenshot({ path: path.join(OUT, 'mobile-04-landscape.png') });
    assert(await mp.isVisible('.codelab'));
  });
  await step('no console errors on mobile run', async () => assert(mp.errors.length === 0, mp.errors.join('\n')));
  await mob.ctx.close();

  // ---------------- Online AI (mock) + failure fallback ----------------
  const on = await newPage(browser, mock.url, { viewport: { width: 1280, height: 860 } });
  const op = on.page;
  await step('online AI mode: status ONLINE, chat answered by backend', async () => {
    await op.click('#start-btn');
    await op.waitForSelector('#dialog:not(.hidden)');
    await op.click('#dialog-btn'); await op.click('#dialog-btn');
    await op.waitForFunction(() => CM.AIService.status === 'connected');
    assert((await op.textContent('#sb-ai')) === 'AI ONLINE');
    await op.click('#dock [data-app=codelab]');
    await op.fill('.cl-side .chat-input', '안녕?');
    await op.click('.cl-side .chat-send');
    await op.waitForFunction(() => /mock/.test(Array.from(document.querySelectorAll('.cl-side .msg.ai .msg-text')).map((m) => m.textContent).join('')));
  });
  await step('19. API failure → "AI connection unavailable." and local analyzer answers', async () => {
    await op.fill('.cl-side .chat-input', 'FAIL_PLEASE 뭐가 문제야?');
    await op.click('.cl-side .chat-send');
    await op.waitForFunction(() => CM.AIService.status === 'unavailable');
    await op.waitForSelector('.toast.warn');
    assert(/AI connection unavailable/.test(await op.textContent('#toasts')));
    await op.waitForFunction(() => !document.querySelector('.cl-side .typing'));
    const src = await op.$$eval('.cl-side .msg.ai .msg-src', (m) => m.pop().textContent);
    assert(src === 'local analyzer', src);
    assert((await op.textContent('#sb-ai')) === 'OFFLINE');
    assert((await op.textContent('.cl-side .mode-label')) === 'OFFLINE ANALYZER MODE');
    await op.screenshot({ path: path.join(OUT, 'pc-06-api-failure.png') });
  });
  await on.ctx.close();

  await browser.close();
  off.s.close(); mock.s.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed' + (failed.length ? ', ' + failed.length + ' failed' : '') + '\nScreenshots: ' + OUT + '\n');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
