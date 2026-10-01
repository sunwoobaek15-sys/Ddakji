/* Project templates and coding missions. Pure data + small test snippets. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  function html(title, scripts, body) {
    return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>' + title + '</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n' +
      body + '\n' + scripts.map(function (s) { return '  <script src="' + s + '"></script>'; }).join('\n') + '\n</body>\n</html>\n';
  }
  var CSS = 'body {\n  margin: 0;\n  padding: 12px;\n  background: #10131c;\n  color: #e6edf3;\n  font-family: sans-serif;\n  text-align: center;\n}\n\ncanvas {\n  width: 100%;\n  max-width: 480px;\n  background: #0b0e15;\n  border: 2px solid #2d3748;\n  border-radius: 8px;\n  touch-action: none;\n}\n';

  var TEMPLATES = {
    first: {
      name: 'My First Game',
      desc: '네모 플레이어를 움직이는 첫 게임',
      files: [
        { name: 'index.html', content: html('My First Game', ['player.js', 'enemy.js', 'game.js'],
          '  <h1 id="title">My First Game</h1>\n  <canvas id="game" width="320" height="240"></canvas>\n  <p id="score">Score: 0</p>') },
        { name: 'style.css', content: CSS },
        { name: 'game.js', content: [
          'const canvas = document.getElementById("game");',
          'const ctx = canvas.getContext("2d");',
          'const keys = {};',
          '',
          'document.addEventListener("keydown", function (e) { keys[e.key] = true; });',
          'document.addEventListener("keyup", function (e) { keys[e.key] = false; });',
          '',
          '// Tap or click the canvas to move the player there.',
          'canvas.addEventListener("pointerdown", function (e) {',
          '  const rect = canvas.getBoundingClientRect();',
          '  player.x = (e.clientX - rect.left) * (canvas.width / rect.width) - player.size / 2;',
          '  player.y = (e.clientY - rect.top) * (canvas.height / rect.height) - player.size / 2;',
          '});',
          '',
          'function update() {',
          '  if (keys["ArrowRight"]) player.x += player.speed;',
          '  if (keys["ArrowLeft"]) player.x -= player.speed;',
          '  if (keys["ArrowUp"]) player.y -= player.speed;',
          '  if (keys["ArrowDown"]) player.y += player.speed;',
          '}',
          '',
          'function draw() {',
          '  ctx.clearRect(0, 0, canvas.width, canvas.height);',
          '  drawPlayer(ctx);',
          '  drawEnemy(ctx);',
          '}',
          '',
          'function loop() {',
          '  update();',
          '  draw();',
          '  requestAnimationFrame(loop);',
          '}',
          '',
          'console.log("Game started!");',
          'loop();',
          ''].join('\n') },
        { name: 'player.js', content: [
          'const player = {',
          '  x: 40,',
          '  y: 110,',
          '  size: 20,',
          '  speed: 3',
          '};',
          '',
          'function drawPlayer(ctx) {',
          '  ctx.fillStyle = "#4fd1c5";',
          '  ctx.fillRect(player.x, player.y, player.size, player.size);',
          '}',
          ''].join('\n') },
        { name: 'enemy.js', content: [
          'const enemy = {',
          '  x: 260,',
          '  y: 110,',
          '  size: 20',
          '};',
          '',
          'function drawEnemy(ctx) {',
          '  ctx.fillStyle = "#f56565";',
          '  ctx.fillRect(enemy.x, enemy.y, enemy.size, enemy.size);',
          '}',
          ''].join('\n') }
      ]
    },
    space: {
      name: 'Space Game',
      desc: '별 사이를 나는 우주선',
      files: [
        { name: 'index.html', content: html('Space Game', ['game.js'], '  <canvas id="space" width="320" height="240"></canvas>') },
        { name: 'style.css', content: CSS },
        { name: 'game.js', content: [
          'const canvas = document.getElementById("space");',
          'const ctx = canvas.getContext("2d");',
          'const ship = { x: 150, y: 200 };',
          'const stars = [];',
          '',
          'for (let i = 0; i < 40; i++) {',
          '  stars.push({ x: Math.random() * 320, y: Math.random() * 240, speed: 1 + Math.random() * 2 });',
          '}',
          '',
          'canvas.addEventListener("pointermove", function (e) {',
          '  const rect = canvas.getBoundingClientRect();',
          '  ship.x = (e.clientX - rect.left) * (canvas.width / rect.width);',
          '});',
          '',
          'function loop() {',
          '  ctx.fillStyle = "#05060a";',
          '  ctx.fillRect(0, 0, canvas.width, canvas.height);',
          '  ctx.fillStyle = "#ffffff";',
          '  for (const star of stars) {',
          '    star.y += star.speed;',
          '    if (star.y > canvas.height) star.y = 0;',
          '    ctx.fillRect(star.x, star.y, 2, 2);',
          '  }',
          '  ctx.fillStyle = "#f6ad55";',
          '  ctx.beginPath();',
          '  ctx.moveTo(ship.x, ship.y - 12);',
          '  ctx.lineTo(ship.x - 10, ship.y + 10);',
          '  ctx.lineTo(ship.x + 10, ship.y + 10);',
          '  ctx.fill();',
          '  requestAnimationFrame(loop);',
          '}',
          '',
          'loop();',
          ''].join('\n') }
      ]
    },
    platform: {
      name: 'Platform Game',
      desc: '점프하는 플랫폼 게임',
      files: [
        { name: 'index.html', content: html('Platform Game', ['game.js'], '  <canvas id="game" width="320" height="240"></canvas>\n  <p>Tap / Space to jump</p>') },
        { name: 'style.css', content: CSS },
        { name: 'game.js', content: [
          'const canvas = document.getElementById("game");',
          'const ctx = canvas.getContext("2d");',
          'const hero = { x: 60, y: 0, vy: 0, size: 20, onGround: false };',
          'const gravity = 0.5;',
          'const groundY = 200;',
          '',
          'function jump() {',
          '  if (hero.onGround) {',
          '    hero.vy = -9;',
          '    hero.onGround = false;',
          '  }',
          '}',
          '',
          'document.addEventListener("keydown", function (e) { if (e.code === "Space") jump(); });',
          'canvas.addEventListener("pointerdown", jump);',
          '',
          'function update() {',
          '  hero.vy += gravity;',
          '  hero.y += hero.vy;',
          '  if (hero.y + hero.size >= groundY) {',
          '    hero.y = groundY - hero.size;',
          '    hero.vy = 0;',
          '    hero.onGround = true;',
          '  }',
          '}',
          '',
          'function draw() {',
          '  ctx.clearRect(0, 0, canvas.width, canvas.height);',
          '  ctx.fillStyle = "#48bb78";',
          '  ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);',
          '  ctx.fillStyle = "#ecc94b";',
          '  ctx.fillRect(hero.x, hero.y, hero.size, hero.size);',
          '}',
          '',
          'function loop() {',
          '  update();',
          '  draw();',
          '  requestAnimationFrame(loop);',
          '}',
          '',
          'loop();',
          ''].join('\n') }
      ]
    },
    rpg: {
      name: 'Mini RPG',
      desc: '콘솔로 즐기는 작은 전투',
      files: [
        { name: 'index.html', content: html('Mini RPG', ['game.js'], '  <h1>Mini RPG</h1>\n  <p id="log">Check the console!</p>') },
        { name: 'style.css', content: CSS },
        { name: 'game.js', content: [
          'const hero = { name: "Hero", hp: 30, attack: 6 };',
          'const slime = { name: "Slime", hp: 18, attack: 3 };',
          '',
          'function hit(attacker, target) {',
          '  const damage = attacker.attack + Math.floor(Math.random() * 3);',
          '  target.hp -= damage;',
          '  console.log(attacker.name + " hits " + target.name + " for " + damage + "!");',
          '}',
          '',
          'let turn = 1;',
          'while (hero.hp > 0 && slime.hp > 0) {',
          '  console.log("Turn " + turn);',
          '  hit(hero, slime);',
          '  if (slime.hp > 0) hit(slime, hero);',
          '  turn++;',
          '}',
          '',
          'const winner = hero.hp > 0 ? hero.name : slime.name;',
          'console.log(winner + " wins!");',
          'document.getElementById("log").textContent = winner + " wins!";',
          ''].join('\n') }
      ]
    },
    blank: {
      name: 'Blank Project',
      desc: '빈 프로젝트',
      files: [
        { name: 'index.html', content: html('Blank Project', ['game.js'], '  <h1 id="title">Hello</h1>') },
        { name: 'style.css', content: CSS },
        { name: 'game.js', content: 'console.log("Hello, world!");\n' }
      ]
    }
  };

  /* Missions. `test` runs inside the sandbox after the mission file and must call pass(msg) or fail(msg). */
  var MISSIONS = [
    {
      id: 'm01', title: 'Make the player move.', file: 'mission01.js',
      goal: 'movePlayer(dx, dy) 함수가 player의 x, y를 dx, dy만큼 바꾸도록 만들어.',
      starter: [
        '// MISSION 01: Make the player move.',
        '// movePlayer(dx, dy)를 부르면 player가 움직여야 해.',
        'const player = { x: 0, y: 0 };',
        '',
        'function movePlayer(dx, dy) {',
        '  // 여기에 코드를 작성해',
        '}',
        '',
        'movePlayer(5, 0);',
        'console.log(player);',
        ''].join('\n'),
      hints: [
        'player의 위치는 player.x 와 player.y 에 들어 있어. 이 값을 바꾸면 움직이는 거야.',
        '지금 값에 dx를 더하고 싶으면 += 를 써봐. 예: 어떤 값 += 더할 값;',
        'player.x += dx; 를 쓰고, 같은 방식으로 y에도 dy를 더해봐.'
      ],
      test: [
        'if (typeof movePlayer !== "function") fail("movePlayer 함수가 없어.");',
        'else {',
        '  player.x = 0; player.y = 0;',
        '  movePlayer(5, 0);',
        '  if (player.x !== 5) fail("movePlayer(5, 0) 후에 player.x가 5가 아니야. 지금: " + player.x);',
        '  else { movePlayer(0, -3); if (player.y !== -3) fail("movePlayer(0, -3) 후에 player.y가 -3이 아니야."); else pass("플레이어가 움직여!"); }',
        '}'].join('\n')
    },
    {
      id: 'm02', title: 'Create an enemy.', file: 'mission02.js',
      goal: 'createEnemy(x, y)가 { x, y, hp } 객체를 돌려주게 만들어. hp는 3이야.',
      starter: [
        '// MISSION 02: Create an enemy.',
        'function createEnemy(x, y) {',
        '  // x, y, hp를 가진 객체를 return 해봐',
        '}',
        '',
        'const slime = createEnemy(100, 50);',
        'console.log(slime);',
        ''].join('\n'),
      hints: [
        '객체는 { 이름: 값, 이름: 값 } 모양으로 만들어.',
        'return { ... }; 처럼 함수가 객체를 돌려주게 하면 돼.',
        'return { x: x, y: y, hp: 3 }; 를 함수 안에 써봐.'
      ],
      test: [
        'if (typeof createEnemy !== "function") fail("createEnemy 함수가 없어.");',
        'else { const e = createEnemy(10, 20);',
        '  if (!e || typeof e !== "object") fail("createEnemy가 객체를 돌려주지 않아.");',
        '  else if (e.x !== 10 || e.y !== 20) fail("x, y 값이 전달한 값과 달라.");',
        '  else if (e.hp !== 3) fail("hp가 3이 아니야.");',
        '  else pass("적이 생겼어!"); }'].join('\n')
    },
    {
      id: 'm03', title: 'Add a score system.', file: 'mission03.js',
      goal: 'score 변수(처음 0)와 addScore(points) 함수를 만들어.',
      starter: [
        '// MISSION 03: Add a score system.',
        'let score = 0;',
        '',
        'function addScore(points) {',
        '  // score에 points를 더해',
        '}',
        '',
        'addScore(10);',
        'console.log("Score: " + score);',
        ''].join('\n'),
      hints: [
        'score는 let으로 만들어서 값을 바꿀 수 있어.',
        'score에 points를 더하려면 += 를 써.',
        'score += points; 한 줄이면 충분해.'
      ],
      test: [
        'if (typeof addScore !== "function") fail("addScore 함수가 없어.");',
        'else { score = 0; addScore(10); addScore(5);',
        '  if (score !== 15) fail("addScore(10), addScore(5) 후 score가 15가 아니야. 지금: " + score);',
        '  else pass("점수가 올라가!"); }'].join('\n')
    },
    {
      id: 'm04', title: 'Create a health bar.', file: 'mission04.js',
      goal: 'takeDamage(n)은 health를 줄이되 0 아래로 내려가지 않게, healthBarWidth(max)는 남은 체력 비율만큼의 너비를 돌려줘.',
      starter: [
        '// MISSION 04: Create a health bar.',
        'let health = 100;',
        '',
        'function takeDamage(amount) {',
        '  // health를 amount만큼 줄여. 단, 0보다 작아지면 안 돼!',
        '}',
        '',
        'function healthBarWidth(maxWidth) {',
        '  // health가 50이면 maxWidth의 절반을 돌려줘',
        '}',
        '',
        'takeDamage(30);',
        'console.log(health, healthBarWidth(200));',
        ''].join('\n'),
      hints: [
        'health -= amount; 로 줄일 수 있어. 그 다음 0보다 작은지 확인해.',
        'Math.max(0, 값) 은 0과 값 중 큰 걸 돌려줘. 음수를 막을 때 좋아.',
        'healthBarWidth는 return maxWidth * (health / 100); 처럼 비율을 곱하면 돼.'
      ],
      test: [
        'if (typeof takeDamage !== "function" || typeof healthBarWidth !== "function") fail("takeDamage와 healthBarWidth 함수가 모두 있어야 해.");',
        'else { health = 100; takeDamage(30);',
        '  if (health !== 70) fail("takeDamage(30) 후 health가 70이 아니야.");',
        '  else if (healthBarWidth(200) !== 140) fail("health 70일 때 healthBarWidth(200)은 140이어야 해.");',
        '  else { takeDamage(500); if (health !== 0) fail("체력이 0보다 작아졌어: " + health); else pass("체력바 완성!"); } }'].join('\n')
    },
    {
      id: 'm05', title: 'Make the enemy chase the player.', file: 'mission05.js',
      goal: 'chase(enemy, target, speed)가 enemy를 target 쪽으로 speed만큼 움직이게 해. 너무 가까우면 target 위치에 딱 멈춰.',
      starter: [
        '// MISSION 05: Make the enemy chase the player.',
        'function chase(enemy, target, speed) {',
        '  const dx = target.x - enemy.x;',
        '  const dy = target.y - enemy.y;',
        '  // 거리(distance)를 구하고, 그 방향으로 speed만큼 이동해',
        '}',
        '',
        'const bat = { x: 0, y: 0 };',
        'chase(bat, { x: 10, y: 0 }, 2);',
        'console.log(bat);',
        ''].join('\n'),
      hints: [
        '거리는 Math.hypot(dx, dy) 로 구할 수 있어.',
        '거리가 speed 이하이면 enemy.x = target.x 처럼 바로 붙여버려.',
        '아니면 enemy.x += dx / distance * speed; 를 x, y 모두에 해봐.'
      ],
      test: [
        'if (typeof chase !== "function") fail("chase 함수가 없어.");',
        'else { const e = { x: 0, y: 0 }; chase(e, { x: 10, y: 0 }, 2);',
        '  if (Math.abs(e.x - 2) > 0.01 || Math.abs(e.y) > 0.01) fail("(0,0)에서 (10,0)으로 speed 2만큼 가면 x가 2여야 해. 지금: " + e.x + ", " + e.y);',
        '  else { const f = { x: 9, y: 0 }; chase(f, { x: 10, y: 0 }, 2);',
        '    if (f.x !== 10) fail("거리가 speed보다 가까우면 target에 딱 멈춰야 해. 지금 x: " + f.x);',
        '    else pass("적이 쫓아와!"); } }'].join('\n')
    },
    {
      id: 'm06', title: 'Create a simple game.', file: 'mission06.js',
      goal: 'isColliding(a, b)로 두 사각형 {x,y,w,h}가 겹치는지, checkGameOver(player, enemies)로 하나라도 부딪혔는지 알려줘.',
      starter: [
        '// MISSION 06: Create a simple game.',
        'function isColliding(a, b) {',
        '  // 두 사각형이 겹치면 true',
        '}',
        '',
        'function checkGameOver(player, enemies) {',
        '  // enemies 중 하나라도 player와 부딪히면 true',
        '}',
        '',
        'const hero = { x: 0, y: 0, w: 10, h: 10 };',
        'console.log(checkGameOver(hero, [{ x: 5, y: 5, w: 10, h: 10 }]));',
        ''].join('\n'),
      hints: [
        '사각형 a와 b가 겹치려면 a의 왼쪽이 b의 오른쪽보다 왼쪽에 있어야 해: a.x < b.x + b.w',
        '네 가지 조건을 && 로 묶어: a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y',
        'checkGameOver는 enemies.some(function (e) { return isColliding(player, e); }) 로 만들 수 있어.'
      ],
      test: [
        'if (typeof isColliding !== "function" || typeof checkGameOver !== "function") fail("isColliding과 checkGameOver 함수가 필요해.");',
        'else { const a = { x: 0, y: 0, w: 10, h: 10 };',
        '  if (isColliding(a, { x: 5, y: 5, w: 10, h: 10 }) !== true) fail("겹치는 두 사각형인데 true가 아니야.");',
        '  else if (isColliding(a, { x: 20, y: 0, w: 10, h: 10 }) !== false) fail("떨어진 사각형인데 false가 아니야.");',
        '  else if (checkGameOver(a, [{ x: 50, y: 50, w: 5, h: 5 }, { x: 8, y: 8, w: 5, h: 5 }]) !== true) fail("적 하나와 부딪혔는데 checkGameOver가 true가 아니야.");',
        '  else if (checkGameOver(a, [{ x: 50, y: 50, w: 5, h: 5 }]) !== false) fail("아무와도 안 부딪혔는데 true가 나왔어.");',
        '  else pass("게임 완성! 충돌 판정이 완벽해."); }'].join('\n')
    }
  ];

  CM.Content = { TEMPLATES: TEMPLATES, MISSIONS: MISSIONS };
})(typeof self !== 'undefined' ? self : this);
