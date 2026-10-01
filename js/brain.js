/* Offline partner brain: rule-based chat, error explanations and fix suggestions.
 * Used when no backend AI is connected (OFFLINE ANALYZER MODE) and as a fallback when it fails. */
(function (root) {
  'use strict';
  var CM = (root.CM = root.CM || {});

  var GLOSSARY = {
    '변수': '변수는 값을 담아두는 이름표 붙은 상자야. let score = 0; 이라고 쓰면 score라는 상자에 0을 넣는 거야.',
    'variable': '변수는 값을 담아두는 이름표 붙은 상자야. let score = 0; 처럼 만들어.',
    'let': 'let은 나중에 값을 바꿀 수 있는 변수를 만들 때 써.',
    'const': 'const는 한 번 넣으면 다시 다른 값을 넣을 수 없는 변수야. 단, 객체 안의 값(player.x)은 바꿀 수 있어.',
    '함수': '함수는 여러 줄의 코드를 묶어서 이름을 붙인 거야. function jump() { ... } 처럼 만들고 jump(); 로 실행해.',
    'function': '함수(function)는 코드 묶음에 이름을 붙인 거야. 필요할 때 이름()으로 불러서 실행해.',
    'if': 'if는 "만약 ~라면"이야. if (score > 10) { ... } 은 score가 10보다 클 때만 안쪽을 실행해.',
    'for': 'for는 반복문이야. for (let i = 0; i < 3; i++) { ... } 는 안쪽을 3번 실행해.',
    'while': 'while은 조건이 참인 동안 계속 반복해. 끝나는 조건을 꼭 만들어줘야 해!',
    '배열': '배열은 여러 값을 순서대로 담는 목록이야. const enemies = [a, b, c]; enemies[0]은 첫 번째 값이야.',
    'array': '배열(array)은 값 여러 개를 순서대로 담는 목록이야. [1, 2, 3] 처럼 써.',
    '객체': '객체는 이름: 값 쌍을 묶은 거야. const player = { x: 10, y: 20 }; 에서 player.x는 10이야.',
    'object': '객체(object)는 { 이름: 값 } 묶음이야. player.x 처럼 점(.)으로 꺼내 써.',
    'canvas': 'canvas는 그림을 그리는 도화지야. getContext("2d")로 붓(ctx)을 얻어서 fillRect 같은 걸로 그려.',
    'console.log': 'console.log(값)은 값을 콘솔(Terminal)에 출력해. 코드가 어떻게 돌아가는지 확인할 때 최고야.',
    'return': 'return은 함수를 끝내면서 결과 값을 돌려줘. return 1 + 2; 면 3을 돌려줘.',
    'addeventlistener': 'addEventListener("click", 함수)는 "클릭되면 이 함수를 실행해줘"라고 예약하는 거야.',
    'requestanimationframe': 'requestAnimationFrame(loop)은 다음 화면을 그릴 때 loop를 실행해줘. 게임 루프를 만들 때 써.',
    '==='  : '=== 는 두 값이 종류까지 똑같은지 비교해. = 는 값을 넣는 거라서 헷갈리면 안 돼!',
    'null': 'null은 "비어 있음"을 뜻해. getElementById가 요소를 못 찾으면 null을 돌려줘.',
    'undefined': 'undefined는 "아직 값이 정해지지 않음"이야. 없는 속성을 읽으면 나와.'
  };

  function lineFromText(text) { var m = /(?:line|라인|줄)\s*(\d+)|(\d+)\s*(?:번째\s*)?(?:줄|라인|line)/i.exec(text); return m ? +(m[1] || m[2]) : null; }

  var Brain = {
    // Explains a runtime / syntax error in plain words. ctx: {code, file, declared:[names]}
    explainError: function (err, ctx) {
      ctx = ctx || {};
      var msg = String(err.message || ''), name = err.name || 'Error', m, text, tip = '';
      var where = err.line ? 'line ' + err.line : '이 근처';
      if (err.friendly) text = err.friendly;
      else if ((m = /(?:Cannot access '([^']+)' before initialization|can't access lexical declaration '([^']+)' before initialization)/.exec(msg))) {
        var v = m[1] || m[2];
        text = v + ' 변수를 만들기 전에 사용하고 있어서 그래. let/const로 만드는 줄을 사용하는 줄보다 위로 옮겨봐.';
      } else if ((m = /^([\w$]+) is not defined$/.exec(msg))) {
        text = "'" + m[1] + "'라는 이름을 찾을 수 없어. 만든 적이 없거나 철자가 다를 수 있어.";
        var c = CM.Analyzer.closest(m[1], (ctx.declared || []).concat(CM.Analyzer.JS_GLOBALS));
        if (c) tip = " 혹시 '" + c.word + "' 아니야?";
      } else if ((m = /([\w$.]+) is not a function/.exec(msg))) {
        text = m[1] + '는 함수가 아닌데 ( )를 붙여서 실행하려고 했어. 이름 철자나, 그 값이 정말 함수인지 확인해봐.';
      } else if ((m = /Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']+)'\))?/.exec(msg)) || (m = /([\w$.]+) is (undefined|null)/.exec(msg))) {
        var what = m[2] && m[1] !== 'undefined' && m[1] !== 'null' ? m[2] : m[1];
        text = '값이 비어 있는(' + what + ') 상태에서 속성' + (m[2] && /reading/.test(msg) ? " '." + m[2] + "'" : '') + '을 읽으려고 했어. getElementById가 요소를 못 찾았거나, 변수에 아직 값이 없는지 확인해봐.';
      } else if ((m = /Cannot set propert(?:y|ies) of (undefined|null)/.exec(msg))) {
        text = '비어 있는(' + m[1] + ') 값에 속성을 넣으려고 했어. 그 앞의 변수가 제대로 만들어졌는지 확인해봐.';
      } else if (/Assignment to constant variable|invalid assignment to const/.test(msg)) {
        text = 'const로 만든 변수에 새 값을 넣으려고 했어. 바뀌는 값이면 let으로 만들어줘.';
      } else if (/Maximum call stack|too much recursion/.test(msg)) {
        text = '함수가 자기 자신을 끝없이 부르고 있어. 멈추는 조건을 만들어줘.';
      } else if (/Infinite loop\?/.test(msg)) {
        text = '반복문이 끝나지 않아서 내가 멈췄어. 반복 조건이 언젠가 false가 되는지 확인해봐.';
      } else if (name === 'TimeoutError') {
        text = '프로그램이 너무 오래 걸려서 멈췄어. 끝나지 않는 반복이 있는지 봐줘.';
      } else if (name === 'SyntaxError') {
        text = '문법 오류야. 괄호나 따옴표, 쉼표가 빠졌는지 확인해봐.';
      } else {
        text = name + ': ' + msg;
      }
      return { title: err.line ? 'Check line ' + err.line + '.' : 'Something went wrong.', text: (err.line ? where + ': ' : '') + text + tip, line: err.line || null, file: err.file || null, source: 'local' };
    },

    // Rule-based chat. ctx: {code, file, issues, lastError, mission, stage}
    chat: function (text, ctx) {
      var t = text.trim(), low = t.toLowerCase(), name = CM.Partner.name;
      var issues = (ctx.issues || []).filter(function (i) { return i.severity !== 'info' || i.type === 'DUPLICATED_CODE' || i.type === 'SIMPLIFICATION'; });
      var top = issues[0];
      var line = lineFromText(t);

      if (/^(hi|hello|hey|안녕|하이|ㅎㅇ)/i.test(low)) return { reply: '안녕! 같이 코딩하자. 막히면 "뭐가 문제야?"라고 물어봐.' };
      if (/누구|who are you|너는 뭐|이름이 뭐/.test(low)) return { reply: '나는 ' + name + ', 너의 코딩 파트너야. 지금은 게임 속 캐릭터로 연출된 모습이고, 오프라인일 때는 내장된 분석기로 도와줘.' };
      if (/고마|thank|thx|ㄳ|땡큐/.test(low)) return { reply: '천만에! 같이 하니까 재밌다.' };
      if (/힌트|hint|도와줘|막혔/.test(low) && ctx.mission) return { hint: true, reply: '' };

      if (/고쳐|fix|수정해|고칠|바꿔줘/.test(low)) {
        var fixable = (ctx.issues || []).filter(function (i) { return i.fix; })[0];
        if (!fixable) {
          if (ctx.lastError) return { reply: '실행 오류는 내가 바로 고치기 어려워. ' + this.explainError(ctx.lastError, ctx).text };
          return { reply: '지금은 자신 있게 고칠 만한 부분이 안 보여. 고치고 싶은 줄 번호를 알려줄래? 예: "line 5 설명해줘"' };
        }
        if (fixable.confidence < 0.7) {
          return { reply: 'line ' + fixable.line + ': ' + fixable.message + ' 그런데 확실하지 않아서 직접 적용하진 않을게. (I might be wrong.)', line: fixable.line };
        }
        return { reply: '수정안을 만들어봤어. line ' + fixable.line + ': ' + fixable.message, fix: { issueKey: fixable.key, before: fixable.fix.before, after: fixable.fix.after }, confidence: fixable.confidence, line: fixable.line };
      }

      if (line && /설명|뭐야|무슨|explain|what/.test(low)) {
        var d = CM.Analyzer.describeLine(ctx.code || '', line);
        var lineIssue = (ctx.issues || []).filter(function (i) { return i.line === line; })[0];
        if (!d && !lineIssue) return { reply: 'line ' + line + '은 비어 있거나 설명할 게 없어 보여.' };
        return { reply: 'line ' + line + ': ' + (d || '') + (lineIssue ? ' 그리고 ' + lineIssue.message : ''), line: line };
      }

      if (/문제|왜 안|안돼|안 돼|에러|오류|error|wrong|bug|버그|틀린/.test(low)) {
        if (ctx.lastError) {
          var ex = this.explainError(ctx.lastError, ctx);
          return { reply: ex.text, line: ex.line };
        }
        if (top) {
          var more = issues.length > 1 ? ' (그 밖에도 ' + (issues.length - 1) + '개 더 있어. 오른쪽 목록을 봐줘.)' : '';
          return { reply: 'line ' + top.line + ': ' + top.message + more, line: top.line };
        }
        return { reply: '지금 이 파일에서는 문제가 안 보여. RUN을 눌러서 실행해봐. 오류가 나면 내가 바로 분석할게.' };
      }

      if (/실행|run|돌려/.test(low)) return { reply: 'RUN 버튼(또는 Ctrl+Enter)을 누르면 실행돼. 결과는 아래 콘솔과 Preview에 나와.', action: 'run' };
      if (/저장|save/.test(low)) return { reply: '코드는 자동으로 저장돼. Ctrl+S로 바로 저장할 수도 있어.' };

      var keys = Object.keys(GLOSSARY);
      for (var i = 0; i < keys.length; i++) {
        if (low.indexOf(keys[i]) >= 0) return { reply: GLOSSARY[keys[i]] };
      }
      if (/미션|mission/.test(low)) return { reply: ctx.mission ? '지금 미션: ' + ctx.mission.title + ' — ' + ctx.mission.goal : '미션은 Code Lab 위쪽 MISSION 버튼이나 AI Room에서 시작할 수 있어.' };

      return { reply: '음, 오프라인 모드라서 그건 잘 모르겠어. 이렇게 물어봐줘: "뭐가 문제야?", "고쳐줘", "line 5 설명해줘", "힌트", "변수가 뭐야?"' };
    }
  };

  CM.Brain = Brain;
})(typeof self !== 'undefined' ? self : this);
