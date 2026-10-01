/* CODEMATE local analyzer (OFFLINE ANALYZER MODE).
 *
 * Works in the browser (window.CM.Analyzer) and in Node (module.exports) so it can be unit-tested.
 * JavaScript is parsed into an AST with acorn and checked with a small scope analysis.
 * HTML / CSS get lighter structural checks.
 *
 * Every issue: { key, type, severity, line, col, title, message, confidence, fix? }
 *   type     : TYPO | SYNTAX_ERROR | UNUSED_VARIABLE | DUPLICATED_CODE | POSSIBLE_BUG | STYLE | SIMPLIFICATION
 *   severity : error | warning | info
 *   fix      : { kind: 'FIX'|'REMOVE'|'APPLY', label, edits:[{start,end,text}], before, after }
 * Fixes are only ever *proposed*; the UI applies them after the player confirms.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/acorn.js'));
  else { root.CM = root.CM || {}; root.CM.Analyzer = factory(root.acorn); }
})(typeof self !== 'undefined' ? self : this, function (acorn) {
  'use strict';

  var TYPES = {
    TYPO: 'TYPO', SYNTAX_ERROR: 'SYNTAX_ERROR', UNUSED_VARIABLE: 'UNUSED_VARIABLE',
    DUPLICATED_CODE: 'DUPLICATED_CODE', POSSIBLE_BUG: 'POSSIBLE_BUG', STYLE: 'STYLE',
    SIMPLIFICATION: 'SIMPLIFICATION', GOOD_CODE: 'GOOD_CODE', SUCCESS: 'SUCCESS'
  };

  var KEYWORDS = ['function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'switch', 'case',
    'break', 'continue', 'class', 'new', 'typeof', 'true', 'false', 'null', 'undefined', 'this', 'default', 'extends'];

  var JS_GLOBALS = ('undefined NaN Infinity globalThis Object Function Array Number parseFloat parseInt Boolean String Symbol ' +
    'Date Promise RegExp Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError JSON Math ' +
    'Intl ArrayBuffer Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array ' +
    'Uint8ClampedArray BigInt BigInt64Array BigUint64Array DataView Map BigInt Set WeakMap WeakSet Proxy Reflect ' +
    'isFinite isNaN encodeURI encodeURIComponent decodeURI decodeURIComponent escape unescape eval arguments ' +
    'window self document console navigator location history screen alert confirm prompt setTimeout clearTimeout ' +
    'setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone fetch ' +
    'localStorage sessionStorage performance Image Audio AudioContext Event CustomEvent KeyboardEvent MouseEvent ' +
    'HTMLElement HTMLCanvasElement CanvasRenderingContext2D Element Node NodeList DOMParser Blob File FileReader URL ' +
    'URLSearchParams Worker WebSocket XMLHttpRequest FormData Headers Request Response innerWidth innerHeight ' +
    'devicePixelRatio getComputedStyle matchMedia atob btoa crypto addEventListener removeEventListener ' +
    'dispatchEvent Path2D OffscreenCanvas ImageData TextEncoder TextDecoder AbortController ResizeObserver ' +
    'IntersectionObserver MutationObserver speechSynthesis Notification name status open close print scrollTo ' +
    'onload onresize onkeydown onkeyup onclick module require exports process').split(/\s+/);

  var KNOWN_MEMBERS = {
    console: 'log warn error info debug table clear group groupEnd time timeEnd count assert dir trace',
    Math: 'abs ceil floor round trunc max min pow sqrt cbrt random sign sin cos tan asin acos atan atan2 hypot log log2 log10 exp PI E LN2 LN10 SQRT2 fround imul clz32 sinh cosh tanh',
    JSON: 'parse stringify',
    Object: 'keys values entries assign freeze create defineProperty fromEntries getPrototypeOf is seal isFrozen getOwnPropertyNames hasOwn',
    Array: 'isArray from of',
    Number: 'isInteger isNaN isFinite parseFloat parseInt MAX_SAFE_INTEGER MIN_SAFE_INTEGER EPSILON MAX_VALUE MIN_VALUE POSITIVE_INFINITY NEGATIVE_INFINITY isSafeInteger',
    document: 'getElementById querySelector querySelectorAll createElement createTextNode body head addEventListener removeEventListener title documentElement getElementsByClassName getElementsByTagName activeElement readyState cookie write createDocumentFragment hidden visibilityState',
    localStorage: 'getItem setItem removeItem clear key length',
    Date: 'now parse UTC',
    Promise: 'all race resolve reject allSettled any',
    String: 'fromCharCode raw fromCodePoint'
  };
  Object.keys(KNOWN_MEMBERS).forEach(function (k) { KNOWN_MEMBERS[k] = KNOWN_MEMBERS[k].split(' '); });

  // Common property / method names used to catch typos like `.lenght` or `addEventListner`.
  var COMMON_PROPS = ('length push pop shift unshift slice splice concat join reverse sort indexOf lastIndexOf includes ' +
    'forEach map filter reduce find findIndex some every fill keys values entries flat flatMap toString toFixed ' +
    'split replace replaceAll trim toUpperCase toLowerCase startsWith endsWith charAt charCodeAt substring padStart ' +
    'repeat addEventListener removeEventListener getContext fillRect strokeRect clearRect fillStyle strokeStyle ' +
    'fillText strokeText beginPath closePath moveTo lineTo arc stroke fill drawImage lineWidth font textAlign ' +
    'textBaseline globalAlpha save restore translate rotate scale width height style innerHTML innerText ' +
    'textContent value appendChild removeChild classList add remove toggle contains setAttribute getAttribute ' +
    'preventDefault stopPropagation target key code clientX clientY offsetX offsetY then catch finally ' +
    'hasOwnProperty call apply bind prototype constructor parentNode children focus blur click onclick checked ' +
    'disabled src href dataset getBoundingClientRect querySelector querySelectorAll position velocity speed ' +
    'health score lives damage name message stack').split(/\s+/);

  var COMMON_PROPS_SET = new Set(COMMON_PROPS);
  var GLOBALS_SET = new Set(JS_GLOBALS);

  // ---------- small helpers ----------
  function editDistance(a, b) { // optimal string alignment (counts a transposition as one edit)
    var al = a.length, bl = b.length;
    if (Math.abs(al - bl) > 2) return 99;
    var d = [];
    for (var i = 0; i <= al; i++) { d[i] = [i]; }
    for (var j = 0; j <= bl; j++) { d[0][j] = j; }
    for (i = 1; i <= al; i++) {
      for (j = 1; j <= bl; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[al][bl];
  }

  function closest(word, candidates, maxDist) {
    var best = null, bestD = 99, tie = false;
    var limit = maxDist !== undefined ? maxDist : (word.length <= 4 ? 1 : 2);
    var seen = new Set();
    candidates.forEach(function (c) {
      if (!c || c === word || seen.has(c)) return;
      seen.add(c);
      var d = editDistance(word, c);
      if (d < bestD) { bestD = d; best = c; tie = false; } else if (d === bestD && c !== best) { tie = true; }
    });
    if (best && bestD <= limit && !tie) return { word: best, dist: bestD };
    // Case-only difference (e.g. getElementByID) always counts as a strong match.
    var lw = word.toLowerCase();
    var ci = Array.from(seen).filter(function (c) { return c.toLowerCase() === lw; });
    if (ci.length === 1) return { word: ci[0], dist: 1 };
    return null;
  }

  function lineStarts(code) {
    var s = [0];
    for (var i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) s.push(i + 1);
    return s;
  }
  function posToLoc(starts, pos) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
  }
  function getLine(code, starts, line) {
    var s = starts[line - 1]; if (s === undefined) return '';
    var e = line < starts.length ? starts[line] - 1 : code.length;
    return code.slice(s, e);
  }
  function snippet(code, starts, fromLine, toLine) {
    var out = [];
    for (var l = fromLine; l <= toLine; l++) out.push(getLine(code, starts, l));
    return out.join('\n');
  }
  function applyEdits(code, edits) {
    var sorted = edits.slice().sort(function (a, b) { return b.start - a.start; });
    sorted.forEach(function (e) { code = code.slice(0, e.start) + e.text + code.slice(e.end); });
    return code;
  }
  function indentOf(code, starts, line) { var m = /^[ \t]*/.exec(getLine(code, starts, line)); return m ? m[0] : ''; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Builds a before/after preview for a set of edits (only the touched lines).
  function previewFor(code, starts, edits) {
    if (!edits.length) return { before: '', after: '' };
    var minS = Math.min.apply(null, edits.map(function (e) { return e.start; }));
    var maxE = Math.max.apply(null, edits.map(function (e) { return e.end; }));
    var l1 = posToLoc(starts, minS).line, l2 = posToLoc(starts, Math.max(minS, maxE - 1)).line;
    var before = snippet(code, starts, l1, l2);
    var after = applyEdits(code, edits);
    var aStarts = lineStarts(after);
    var delta = after.length - code.length;
    var l2a = posToLoc(aStarts, Math.max(minS, maxE + delta - 1)).line;
    return { before: before, after: snippet(after, aStarts, l1, Math.max(l1, l2a)) };
  }

  // ---------- 1. bracket / quote scanner (gives beginner friendly messages before the parser does) ----------
  var PAIRS = { '(': ')', '[': ']', '{': '}' };
  var NAMES = { '(': '소괄호 (', ')': '소괄호 )', '[': '대괄호 [', ']': '대괄호 ]', '{': '중괄호 {', '}': '중괄호 }' };

  function scanBrackets(code) {
    var stack = [], i = 0, n = code.length, lastSig = '', tplDepth = [];
    var regexAllowedAfter = /^(?:[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|do|else|in|of|new|delete|void|throw|)$/;
    var lastWord = '';
    while (i < n) {
      var c = code[i];
      if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
      if (c === '/' && code[i + 1] === '*') {
        var end = code.indexOf('*/', i + 2);
        if (end < 0) return { kind: 'comment', pos: i };
        i = end + 2; continue;
      }
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n && code[j] !== c && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
        if (j >= n || code[j] === '\n') return { kind: 'quote', pos: i, quote: c, endPos: j };
        i = j + 1; lastSig = 'str'; lastWord = ''; continue;
      }
      if (c === '`') {
        var k = i + 1, closed = false;
        while (k < n) {
          if (code[k] === '\\') { k += 2; continue; }
          if (code[k] === '`') { closed = true; break; }
          if (code[k] === '$' && code[k + 1] === '{') {
            // nested expression inside template: let the main loop handle it by recursion-lite
            var depth = 1, m = k + 2;
            while (m < n && depth > 0) { if (code[m] === '{') depth++; else if (code[m] === '}') depth--; m++; }
            k = m; continue;
          }
          k++;
        }
        if (!closed) return { kind: 'template', pos: i };
        i = k + 1; lastSig = 'str'; continue;
      }
      if (c === '/' && regexAllowedAfter.test(lastWord || lastSig)) {
        var r = i + 1, inClass = false;
        while (r < n && code[r] !== '\n') {
          if (code[r] === '\\') { r += 2; continue; }
          if (code[r] === '[') inClass = true; else if (code[r] === ']') inClass = false;
          else if (code[r] === '/' && !inClass) break;
          r++;
        }
        if (r < n && code[r] === '/') { i = r + 1; while (/[a-z]/i.test(code[i] || '')) i++; lastSig = 'regex'; continue; }
      }
      if (PAIRS[c]) { stack.push({ ch: c, pos: i }); lastSig = c; lastWord = ''; i++; continue; }
      if (c === ')' || c === ']' || c === '}') {
        if (!stack.length) return { kind: 'extra', pos: i, ch: c };
        var top = stack[stack.length - 1];
        if (PAIRS[top.ch] !== c) return { kind: 'mismatch', pos: i, ch: c, open: top };
        stack.pop(); lastSig = c; lastWord = ''; i++; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        var w = i; while (w < n && /[\w$]/.test(code[w])) w++;
        lastWord = code.slice(i, w); lastSig = 'id'; i = w; continue;
      }
      if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
      i++;
    }
    void tplDepth;
    if (stack.length) return { kind: 'unclosed', pos: stack[stack.length - 1].pos, ch: stack[stack.length - 1].ch, stack: stack };
    return null;
  }

  function bracketIssue(code, starts, b) {
    var loc = posToLoc(starts, b.pos);
    var issue = { key: 'syntax:bracket', type: TYPES.SYNTAX_ERROR, severity: 'error', line: loc.line, col: loc.col, confidence: 0.9 };
    var edits = null;
    if (b.kind === 'quote') {
      issue.key = 'syntax:quote';
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '에서 연 따옴표(' + b.quote + ')가 닫히지 않았어. 문자열 끝에 ' + b.quote + ' 를 붙여봐.';
      // Propose closing quote before trailing `);` style characters on that line.
      var lineEnd = b.endPos;
      var lineText = code.slice(b.pos, lineEnd);
      var tail = /[)\];,]*\s*$/.exec(lineText);
      var insertAt = lineEnd - (tail ? tail[0].length : 0);
      if (insertAt <= b.pos) insertAt = lineEnd;
      edits = [{ start: insertAt, end: insertAt, text: b.quote }];
      issue.confidence = 0.65;
    } else if (b.kind === 'template') {
      issue.key = 'syntax:template';
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '에서 시작한 백틱(`) 문자열이 끝나지 않았어.';
    } else if (b.kind === 'comment') {
      issue.key = 'syntax:comment';
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '의 여러 줄 주석(/*)이 */ 로 닫히지 않았어.';
      edits = [{ start: code.length, end: code.length, text: (code.endsWith('\n') ? '' : '\n') + '*/\n' }];
      issue.confidence = 0.7;
    } else if (b.kind === 'extra') {
      issue.key = 'syntax:extra' + b.ch;
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '에 닫는 ' + NAMES[b.ch] + ' 가 하나 더 있어. 여는 괄호 없이 닫고 있어.';
      edits = [{ start: b.pos, end: b.pos + 1, text: '' }];
      issue.confidence = 0.6;
    } else if (b.kind === 'mismatch') {
      var oLoc = posToLoc(starts, b.open.pos);
      issue.key = 'syntax:mismatch';
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '에 ' + NAMES[b.ch] + ' 가 있는데, 여기서는 line ' + oLoc.line + '에서 연 ' +
        NAMES[b.open.ch] + ' 를 먼저 ' + PAIRS[b.open.ch] + ' 로 닫아야 해.';
      issue.confidence = 0.75;
    } else if (b.kind === 'unclosed') {
      issue.key = 'syntax:unclosed' + b.ch;
      issue.title = 'Something is wrong here.';
      issue.message = 'line ' + loc.line + '에서 연 ' + NAMES[b.ch] + ' 가 닫히지 않았어. 어딘가에 ' + PAIRS[b.ch] + ' 가 빠졌어.';
      if (b.ch === '{' && b.stack.length === 1) {
        edits = [{ start: code.length, end: code.length, text: (code.endsWith('\n') ? '' : '\n') + '}\n' }];
        issue.confidence = 0.55;
      } else issue.confidence = 0.8;
    }
    if (edits) {
      var p = previewFor(code, starts, edits);
      issue.fix = { kind: 'FIX', label: 'FIX', edits: edits, before: p.before, after: p.after };
    }
    return issue;
  }

  // ---------- 2. parser errors ----------
  function friendlyParseMessage(msg, name) {
    var m;
    if (/Unterminated string/.test(msg)) return '문자열 따옴표가 닫히지 않았어.';
    if (/Unterminated template/.test(msg)) return '백틱(`) 문자열이 닫히지 않았어.';
    if ((m = /Identifier '(.+)' has already been declared/.exec(msg))) return "'" + m[1] + "'라는 이름을 두 번 만들었어. 하나는 이름을 바꾸거나 let/const를 빼봐.";
    if (/Assigning to rvalue/.test(msg)) return '값을 넣을 수 없는 곳에 = 를 썼어. 비교하려던 거라면 === 를 써봐.';
    if (/'return' outside of function/.test(msg)) return 'return은 함수 안에서만 쓸 수 있어.';
    if ((m = /Unexpected keyword '(.+)'/.exec(msg))) return "'" + m[1] + "'는 여기에 올 수 없는 예약어야.";
    if (/Unexpected token/.test(msg)) return (name ? "'" + name + "' 근처에서" : '이 근처에서') + ' 문법이 맞지 않아. 빠진 쉼표(,), 괄호, 연산자가 있는지 봐줘.';
    if (/Unexpected character/.test(msg)) return '자바스크립트에서 쓸 수 없는 문자가 들어 있어.';
    if (/Invalid regular expression/.test(msg)) return '정규식(/.../) 모양이 잘못됐어.';
    if (/Deleting local variable/.test(msg)) return '변수는 delete로 지울 수 없어.';
    return '문법 오류가 있어. (' + msg.replace(/\s*\(\d+:\d+\)$/, '') + ')';
  }

  // Keyword typos like `fucntion`, `retrun`, `cosnt` near a parse error.
  function keywordTypo(code, starts, line, declared) {
    var range = [line - 1, line].filter(function (l) { return l >= 1; });
    var found = null;
    range.forEach(function (l) {
      if (found) return;
      var text = getLine(code, starts, l), re = /[A-Za-z_$][\w$]*/g, m;
      var stripped = text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, function (s) { return ' '.repeat(s.length); }).replace(/\/\/.*$/, '');
      while ((m = re.exec(stripped))) {
        var w = m[0];
        if (KEYWORDS.indexOf(w) >= 0 || declared.has(w) || w.length < 3) continue;
        var c = closest(w, KEYWORDS, w.length <= 4 ? 1 : 2);
        if (c && editDistance(w.toLowerCase(), c.word) <= 2) {
          var start = starts[l - 1] + m.index;
          found = { word: w, fixWord: c.word, start: start, end: start + w.length, line: l, col: m.index + 1 };
          return;
        }
      }
    });
    return found;
  }

  // ---------- 3. AST walking helpers ----------
  function children(node) {
    var out = [];
    for (var k in node) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type' || k === 'range') continue;
      var v = node[k];
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (v[i] && typeof v[i].type === 'string') out.push(v[i]); }
      else if (v && typeof v.type === 'string') out.push(v);
    }
    return out;
  }
  function walk(node, fn, parent) {
    if (fn(node, parent) === false) return;
    var ch = children(node);
    for (var i = 0; i < ch.length; i++) walk(ch[i], fn, node);
  }
  var isFn = function (n) { return n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'); };

  function Scope(type, parent, node) {
    this.type = type; this.parent = parent; this.node = node; this.decls = new Map();
    this.fnScope = (type === 'function' || type === 'global') ? this : parent.fnScope;
  }
  Scope.prototype.lookup = function (name) {
    var s = this;
    while (s) { if (s.decls.has(name)) return s.decls.get(name); s = s.parent; }
    return null;
  };

  function patternIds(p, out) {
    if (!p) return out;
    switch (p.type) {
      case 'Identifier': out.push(p); break;
      case 'ObjectPattern': p.properties.forEach(function (pr) { patternIds(pr.type === 'RestElement' ? pr.argument : pr.value, out); }); break;
      case 'ArrayPattern': p.elements.forEach(function (e) { patternIds(e, out); }); break;
      case 'RestElement': patternIds(p.argument, out); break;
      case 'AssignmentPattern': patternIds(p.left, out); break;
    }
    return out;
  }

  // ---------- 4. JavaScript analysis ----------
  function analyzeJS(code, opts) {
    var issues = [];
    var starts = lineStarts(code);
    var info = { decls: [], refs: [], propNames: [] };
    if (!code.trim()) return { issues: issues, info: info, parsed: true };

    var b = scanBrackets(code);
    var ast = null, parseErr = null;
    try {
      ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
    } catch (e) { parseErr = e; }

    if (parseErr || b) {
      // Gather words that are declared (roughly) so keyword typo detection does not flag real names.
      var declared = new Set();
      code.replace(/\b(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/g, function (_, n) { declared.add(n); return _; });
      var errLine = parseErr && parseErr.loc ? parseErr.loc.line : (b ? posToLoc(starts, b.pos).line : 1);
      var kw = keywordTypo(code, starts, errLine, declared);
      if (kw && (!b || b.kind === 'unclosed')) {
        var edits = [{ start: kw.start, end: kw.end, text: kw.fixWord }];
        var fixed = applyEdits(code, edits), ok = true;
        try { acorn.parse(fixed, { ecmaVersion: 'latest' }); } catch (e2) { ok = false; }
        var pv = previewFor(code, starts, edits);
        issues.push({
          key: 'typo:' + kw.word, type: TYPES.TYPO, severity: 'error', line: kw.line, col: kw.col,
          title: 'Typo detected.', word: kw.word, suggestion: kw.fixWord,
          message: "'" + kw.word + "' → '" + kw.fixWord + "' 오타 같아. 자바스크립트 키워드는 철자가 정확해야 해.",
          confidence: ok ? 0.92 : 0.7,
          fix: { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after }
        });
        return { issues: issues, info: info, parsed: false };
      }
      if (b) { issues.push(bracketIssue(code, starts, b)); return { issues: issues, info: info, parsed: false }; }
      var tokName = null;
      if (parseErr.pos !== undefined) { var mm = /^[\w$]+|^\S/.exec(code.slice(parseErr.pos)); tokName = mm ? mm[0] : null; }
      issues.push({
        key: 'syntax:' + (parseErr.message || '').replace(/\s*\(\d+:\d+\)$/, ''), type: TYPES.SYNTAX_ERROR, severity: 'error',
        line: parseErr.loc ? parseErr.loc.line : 1, col: parseErr.loc ? parseErr.loc.column + 1 : 1,
        title: 'Something is wrong here.', message: friendlyParseMessage(parseErr.message || '', tokName), confidence: 0.85,
        raw: parseErr.message
      });
      return { issues: issues, info: info, parsed: false };
    }

    // --- pass 1: scopes and declarations ---
    var scopes = new Map();
    var global = new Scope('global', null, ast);
    scopes.set(ast, global);
    var allDecls = [];

    function declare(scope, idNode, kind, declNode, stmt) {
      var d = { name: idNode.name, kind: kind, id: idNode, declNode: declNode, stmt: stmt, scope: scope, reads: 0, writes: 0, refs: [] };
      if (!scope.decls.has(idNode.name)) scope.decls.set(idNode.name, d);
      allDecls.push(d);
      return d;
    }

    (function pass1(node, scope, parent) {
      var s = scope;
      switch (node.type) {
        case 'FunctionDeclaration':
          if (node.id) declare(scope, node.id, 'function', node, node);
          s = new Scope('function', scope, node); scopes.set(node, s);
          node.params.forEach(function (p) { patternIds(p, []).forEach(function (id) { declare(s, id, 'param', node, null); }); });
          break;
        case 'FunctionExpression': case 'ArrowFunctionExpression':
          s = new Scope('function', scope, node); scopes.set(node, s);
          if (node.id) declare(s, node.id, 'fname', node, null);
          node.params.forEach(function (p) { patternIds(p, []).forEach(function (id) { declare(s, id, 'param', node, null); }); });
          break;
        case 'ClassDeclaration':
          if (node.id) declare(scope, node.id, 'class', node, node);
          break;
        case 'VariableDeclaration':
          var target = node.kind === 'var' ? scope.fnScope : scope;
          node.declarations.forEach(function (dcl) {
            patternIds(dcl.id, []).forEach(function (id) { declare(target, id, node.kind, dcl, node); });
          });
          break;
        case 'BlockStatement':
          if (!isFn(parent)) { s = new Scope('block', scope, node); scopes.set(node, s); }
          break;
        case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'SwitchStatement':
          s = new Scope('block', scope, node); scopes.set(node, s);
          break;
        case 'CatchClause':
          s = new Scope('block', scope, node); scopes.set(node, s);
          if (node.param) patternIds(node.param, []).forEach(function (id) { declare(s, id, 'catch', node, null); });
          break;
      }
      children(node).forEach(function (c) { pass1(c, s, node); });
    })(ast, global, null);

    // --- pass 2: references ---
    var unresolved = []; // {node, name, isWrite, inTypeof}
    var refsAll = new Set();
    var propNames = new Set(); // property names defined in this file (object keys, assignments, class members)
    var propReads = []; // {node, objName}

    function resolve(idNode, scope, isWrite, isRead, parent) {
      refsAll.add(idNode.name);
      var d = scope.lookup(idNode.name);
      if (d) {
        if (isRead) d.reads++;
        if (isWrite) d.writes++;
        d.refs.push(idNode);
        // temporal dead zone: let/const/class used before its declaration in the same function
        if ((d.kind === 'let' || d.kind === 'const' || d.kind === 'class') && idNode.start < d.id.start && scope.fnScope === d.scope.fnScope) {
          d.tdz = d.tdz || idNode;
        }
        if (isWrite && d.kind === 'const') d.constWrite = d.constWrite || idNode;
      } else {
        unresolved.push({ node: idNode, name: idNode.name, isWrite: isWrite && !isRead, inTypeof: parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof' });
      }
    }

    function visitPatternDecl(p, scope) { // defaults inside destructuring patterns are reads
      if (!p) return;
      if (p.type === 'AssignmentPattern') { visitPatternDecl(p.left, scope); visit(p.right, scope, p); }
      else if (p.type === 'ObjectPattern') p.properties.forEach(function (pr) {
        if (pr.type === 'RestElement') visitPatternDecl(pr.argument, scope);
        else { if (pr.computed) visit(pr.key, scope, pr); visitPatternDecl(pr.value, scope); }
      });
      else if (p.type === 'ArrayPattern') p.elements.forEach(function (e) { visitPatternDecl(e, scope); });
      else if (p.type === 'RestElement') visitPatternDecl(p.argument, scope);
    }

    function visitAssignTarget(t, scope, isRead, parent) {
      if (t.type === 'Identifier') resolve(t, scope, true, isRead, parent);
      else if (t.type === 'MemberExpression') {
        visit(t.object, scope, t);
        if (t.computed) visit(t.property, scope, t);
        else if (t.property.type === 'Identifier') propNames.add(t.property.name);
      } else if (t.type === 'ObjectPattern' || t.type === 'ArrayPattern') {
        patternIds(t, []).forEach(function (id) { resolve(id, scope, true, false, parent); });
      } else visit(t, scope, parent);
    }

    function visit(node, scope, parent) {
      if (!node) return;
      var s = scopes.get(node) || scope;
      switch (node.type) {
        case 'Identifier': resolve(node, scope, false, true, parent); return;
        case 'VariableDeclarator':
          visitPatternDecl(node.id, scope);
          if (node.init) visit(node.init, scope, node);
          return;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
          node.params.forEach(function (p) { visitPatternDecl(p, s); });
          visit(node.body, s, node);
          return;
        case 'ClassDeclaration': case 'ClassExpression':
          if (node.superClass) visit(node.superClass, scope, node);
          node.body.body.forEach(function (m) {
            if (m.key && !m.computed && m.key.type === 'Identifier') propNames.add(m.key.name);
            if (m.computed) visit(m.key, scope, m);
            if (m.value) visit(m.value, scope, m);
          });
          return;
        case 'MemberExpression':
          visit(node.object, scope, node);
          if (node.computed) visit(node.property, scope, node);
          else if (node.property.type === 'Identifier') propReads.push({ node: node.property, member: node, objName: node.object.type === 'Identifier' ? node.object.name : null, parent: parent });
          return;
        case 'Property':
          if (node.computed) visit(node.key, scope, node);
          else if (node.key.type === 'Identifier') propNames.add(node.key.name);
          else if (node.key.type === 'Literal') propNames.add(String(node.key.value));
          visit(node.value, scope, node);
          return;
        case 'AssignmentExpression':
          visitAssignTarget(node.left, scope, node.operator !== '=', node);
          visit(node.right, scope, node);
          return;
        case 'UpdateExpression':
          visitAssignTarget(node.argument, scope, true, node);
          return;
        case 'ForInStatement': case 'ForOfStatement':
          if (node.left.type === 'VariableDeclaration') visit(node.left, s, node);
          else visitAssignTarget(node.left, s, false, node);
          visit(node.right, s, node); visit(node.body, s, node);
          return;
        case 'LabeledStatement': visit(node.body, scope, node); return;
        case 'BreakStatement': case 'ContinueStatement': return;
        case 'CatchClause':
          visit(node.body, s, node); return;
        case 'MethodDefinition': case 'PropertyDefinition':
          if (node.computed) visit(node.key, scope, node);
          if (node.value) visit(node.value, scope, node);
          return;
        case 'MetaProperty': case 'Super': case 'ThisExpression': case 'Literal': case 'TemplateElement': return;
      }
      children(node).forEach(function (c) { visit(c, s, node); });
    }
    visit(ast, global, null);

    info.decls = Array.from(global.decls.keys());
    info.refs = Array.from(refsAll);
    info.propNames = Array.from(propNames);

    var declaredNames = new Set(allDecls.map(function (d) { return d.name; }));
    var projectGlobals = new Set(opts.projectGlobals || []);
    var projectUsages = new Set(opts.projectUsages || []);
    var projectProps = new Set(opts.projectProps || []);
    var htmlText = opts.htmlText || '';
    var hostGlobal = opts.hostGlobals; // optional function(name) -> bool (browser `name in window`)

    // --- undeclared names and typos ---
    var typoTargets = new Set();
    var byName = new Map();
    unresolved.forEach(function (u) {
      if (u.inTypeof) return;
      if (GLOBALS_SET.has(u.name) || projectGlobals.has(u.name)) return;
      if (!byName.has(u.name)) byName.set(u.name, []);
      byName.get(u.name).push(u);
    });
    byName.forEach(function (list, name) {
      var writesOnly = list.every(function (u) { return u.isWrite; });
      var candidates = Array.from(declaredNames).concat(Array.from(projectGlobals)).concat(JS_GLOBALS);
      var c = closest(name, candidates);
      var first = list[0].node;
      if (c) {
        typoTargets.add(c.word);
        var edits = list.map(function (u) { return { start: u.node.start, end: u.node.end, text: c.word }; });
        var pv = previewFor(code, starts, edits.slice(0, 1));
        issues.push({
          key: 'typo:' + name, type: TYPES.TYPO, severity: 'error', line: first.loc.start.line, col: first.loc.start.column + 1,
          title: 'Typo detected.', word: name, suggestion: c.word,
          message: "'" + name + "' → '" + c.word + "' 아닐까? 이 이름은 다른 곳에서 만든 이름과 철자가 조금 달라 보여. 오타인지 확인해봐." +
            (list.length > 1 ? ' (' + list.length + '군데)' : ''),
          confidence: c.dist === 1 ? 0.9 : 0.7,
          fix: { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after }
        });
        return;
      }
      if (hostGlobal && hostGlobal(name)) return;
      if (writesOnly) {
        issues.push({
          key: 'implicit:' + name, type: TYPES.POSSIBLE_BUG, severity: 'warning', line: first.loc.start.line, col: first.loc.start.column + 1,
          title: 'I think I found something.',
          message: "'" + name + "'를 let/const 없이 바로 값만 넣고 있어. 처음 만드는 변수라면 앞에 let을 붙여줘.",
          confidence: 0.75
        });
        return;
      }
      issues.push({
        key: 'undeclared:' + name, type: TYPES.POSSIBLE_BUG, severity: 'error', line: first.loc.start.line, col: first.loc.start.column + 1,
        title: 'Check line ' + first.loc.start.line + '.',
        message: "'" + name + "'라는 이름은 어디에서도 만들어지지 않았어. 실행하면 'is not defined' 오류가 날 거야.",
        confidence: 0.8
      });
    });

    // --- string id typos: document.getElementById("plyaer") ---
    var htmlIds = opts.htmlIds || [];
    walk(ast, function (n, parent) {
      if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.computed) return;
      var method = n.callee.property.name;
      var arg = n.arguments[0];
      if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return;
      var idVal = null, prefix = '';
      if (method === 'getElementById') idVal = arg.value;
      else if ((method === 'querySelector') && /^#[\w-]+$/.test(arg.value)) { idVal = arg.value.slice(1); prefix = '#'; }
      if (idVal === null) return;
      if (htmlIds.length && htmlIds.indexOf(idVal) >= 0) return;
      var c = htmlIds.length ? closest(idVal, htmlIds) : null;
      var conf = 0.85, why = 'index.html에는';
      if (!c && parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
        var vn = parent.id.name;
        if (vn !== idVal && editDistance(idVal.toLowerCase(), vn.toLowerCase()) <= 2 && (!htmlIds.length || htmlIds.indexOf(vn) >= 0 || true)) {
          c = { word: vn, dist: 1 }; conf = 0.6; why = '변수 이름과 비교하면';
        }
      }
      var q = code[arg.start];
      if (c) {
        var edits = [{ start: arg.start, end: arg.end, text: q + prefix + c.word + q }];
        var pv = previewFor(code, starts, edits);
        issues.push({
          key: 'typo:' + idVal, type: TYPES.TYPO, severity: 'warning', line: arg.loc.start.line, col: arg.loc.start.column + 1,
          title: 'Typo detected.', word: idVal, suggestion: c.word,
          message: '"' + idVal + '" → "' + c.word + '" 일 가능성이 높아. ' + why + ' "' + c.word + '" 가 있어.',
          confidence: conf,
          fix: { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after }
        });
      } else if (htmlIds.length) {
        issues.push({
          key: 'missingid:' + idVal, type: TYPES.POSSIBLE_BUG, severity: 'warning', line: arg.loc.start.line, col: arg.loc.start.column + 1,
          title: 'I think I found something.',
          message: 'index.html에 id="' + idVal + '" 인 요소가 없어. 이 코드는 null을 받게 될 거야.',
          confidence: 0.7
        });
      }
    });

    // --- property typos: console.lgo, arr.lenght, player.spedd ---
    var definedProps = new Set(Array.from(propNames).concat(Array.from(projectProps)));
    var reportedProps = new Set();
    propReads.forEach(function (pr) {
      var p = pr.node.name, objName = pr.objName;
      if (reportedProps.has(p)) return;
      var known = objName && KNOWN_MEMBERS[objName] && !(declaredNames.has(objName));
      var c = null, conf = 0;
      if (known) {
        if (KNOWN_MEMBERS[objName].indexOf(p) >= 0) return;
        c = closest(p, KNOWN_MEMBERS[objName]); conf = 0.9;
        if (!c) {
          reportedProps.add(p);
          issues.push({
            key: 'member:' + objName + '.' + p, type: TYPES.POSSIBLE_BUG, severity: 'error', line: pr.node.loc.start.line, col: pr.node.loc.start.column + 1,
            title: 'Check line ' + pr.node.loc.start.line + '.',
            message: objName + '에는 ' + p + ' 라는 기능이 없어. 철자를 확인해봐.', confidence: 0.75
          });
          return;
        }
      } else {
        if (COMMON_PROPS_SET.has(p) || definedProps.has(p) || p.length < 4) return;
        c = closest(p, Array.from(definedProps), 1) || closest(p, COMMON_PROPS, 1);
        conf = c && definedProps.has(c.word) ? 0.72 : 0.62;
        if (!c) return;
      }
      reportedProps.add(p);
      var edits = propReads.filter(function (o) { return o.node.name === p && (!known || o.objName === objName); })
        .map(function (o) { return { start: o.node.start, end: o.node.end, text: c.word }; });
      var pv = previewFor(code, starts, edits.slice(0, 1));
      issues.push({
        key: 'typo:.' + p, type: TYPES.TYPO, severity: known ? 'error' : 'warning', line: pr.node.loc.start.line, col: pr.node.loc.start.column + 1,
        title: 'Typo detected.', word: p, suggestion: c.word,
        message: "'." + p + "' → '." + c.word + "' 아닐까? 속성 이름 철자가 조금 달라 보여.",
        confidence: conf,
        fix: { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after }
      });
    });

    // --- per-declaration checks: TDZ, const writes, unused ---
    var ignored = new Set(opts.ignored || []);
    allDecls.forEach(function (d) {
      if (d.tdz) {
        issues.push({
          key: 'tdz:' + d.name, type: TYPES.POSSIBLE_BUG, severity: 'error', line: d.tdz.loc.start.line, col: d.tdz.loc.start.column + 1,
          title: 'Check line ' + d.tdz.loc.start.line + '.',
          message: d.name + ' 변수를 만들기 전에 사용하고 있어. (line ' + d.id.loc.start.line + '에서 만들고 line ' + d.tdz.loc.start.line +
            '에서 먼저 쓰고 있어.) 선언하는 줄을 위로 옮겨봐.',
          confidence: 0.9
        });
      }
      if (d.constWrite) {
        var kwPos = d.stmt && d.stmt.type === 'VariableDeclaration' ? d.stmt.start : -1;
        var issue = {
          key: 'constwrite:' + d.name, type: TYPES.POSSIBLE_BUG, severity: 'error', line: d.constWrite.loc.start.line, col: d.constWrite.loc.start.column + 1,
          title: 'Check line ' + d.constWrite.loc.start.line + '.',
          message: d.name + '는 const로 만들어서 값을 바꿀 수 없어. 바꿔야 하는 값이면 let으로 만들어줘.',
          confidence: 0.85
        };
        if (kwPos >= 0 && code.slice(kwPos, kwPos + 5) === 'const') {
          var edits = [{ start: kwPos, end: kwPos + 5, text: 'let' }];
          var pv = previewFor(code, starts, edits);
          issue.fix = { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after };
        }
        issues.push(issue);
      }
      // unused
      if (d.reads > 0 || typoTargets.has(d.name) || d.kind === 'param' || d.kind === 'catch' || d.kind === 'fname' || d.name.charAt(0) === '_') return;
      var isTop = d.scope === global;
      if (isTop && (opts.isMission || projectUsages.has(d.name) || new RegExp('\\b' + d.name.replace(/\$/g, '\\$') + '\\b').test(htmlText))) return;
      var key = 'unused:' + d.name;
      if (ignored.has(key)) return;
      if (d.kind === 'function' || d.kind === 'class') {
        issues.push({
          key: key, type: TYPES.STYLE, severity: 'info', line: d.id.loc.start.line, col: d.id.loc.start.column + 1,
          title: 'This ' + (d.kind === 'function' ? 'function' : 'class') + " isn't used yet.",
          message: d.name + (d.kind === 'function' ? ' 함수는' : ' 클래스는') + ' 아직 아무 데서도 사용되지 않아. 나중에 쓸 거라면 KEEP을 눌러줘.',
          confidence: 0.7, keepable: true
        });
        return;
      }
      var stmt = d.stmt;
      var issueU = {
        key: key, type: TYPES.UNUSED_VARIABLE, severity: 'warning', line: d.id.loc.start.line, col: d.id.loc.start.column + 1,
        title: "This variable doesn't seem to be used.",
        message: d.name + (d.writes ? ' 변수에 값을 넣기만 하고 읽는 곳이 없어.' : ' 변수는 만들어졌지만 어디에서도 사용되지 않아.') + ' 필요 없다면 지워도 돼.',
        confidence: 0.85, keepable: true
      };
      if (stmt && stmt.type === 'VariableDeclaration' && d.declNode.id.type === 'Identifier' && !d.writes) {
        var removal = removalEdits(code, starts, stmt, d.declNode);
        if (removal) {
          var init = d.declNode.init, sideFx = false;
          if (init) walk(init, function (n) { if (/CallExpression|NewExpression|AssignmentExpression|UpdateExpression|AwaitExpression/.test(n.type)) sideFx = true; });
          if (sideFx) { issueU.confidence = 0.6; issueU.message += ' (오른쪽에서 함수를 호출하고 있어서, 지우면 그 호출도 사라져.)'; }
          var pvr = previewFor(code, starts, removal);
          issueU.fix = { kind: 'REMOVE', label: 'REMOVE', edits: removal, before: pvr.before, after: pvr.after || '(삭제됨)' };
        }
      }
      issues.push(issueU);
    });

    // --- statement-level checks ---
    var reportedDupLines = new Set();
    function checkList(list) {
      if (!list || !list.length) return;
      // consecutive identical statements
      var i = 0;
      while (i < list.length) {
        var j = i + 1;
        var norm = list[i].type === 'ExpressionStatement' ? code.slice(list[i].start, list[i].end).replace(/\s+/g, '').replace(/;$/, '') : null;
        while (norm && j < list.length && list[j].type === 'ExpressionStatement' &&
          code.slice(list[j].start, list[j].end).replace(/\s+/g, '').replace(/;$/, '') === norm) j++;
        var count = j - i;
        if (norm && count >= 3) {
          var dup = repeatIssue(code, starts, list.slice(i, j), declaredNames);
          if (dup) { issues.push(dup); for (var l = dup.line; l <= dup.endLine; l++) reportedDupLines.add(l); }
        }
        i = j;
      }
      // unreachable code after return/throw/break/continue
      for (var k = 0; k < list.length - 1; k++) {
        if (/ReturnStatement|ThrowStatement|BreakStatement|ContinueStatement/.test(list[k].type)) {
          var next = list.slice(k + 1).filter(function (st) { return st.type !== 'FunctionDeclaration' && !(st.type === 'VariableDeclaration' && st.kind === 'var'); })[0];
          if (next) {
            issues.push({
              key: 'unreachable:' + next.loc.start.line, type: TYPES.POSSIBLE_BUG, severity: 'warning', line: next.loc.start.line, col: next.loc.start.column + 1,
              title: 'I think I found something.',
              message: 'line ' + list[k].loc.start.line + '의 ' + list[k].type.replace('Statement', '').toLowerCase() + ' 뒤에 있는 코드는 절대 실행되지 않아.',
              confidence: 0.85
            });
          }
          break;
        }
      }
    }

    var depthMax = { depth: 0, node: null };
    (function walkDepth(node, depth, parent) {
      var nd = depth;
      if (/^(IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement|SwitchStatement)$/.test(node.type) &&
        !(node.type === 'IfStatement' && parent && parent.type === 'IfStatement' && parent.alternate === node)) {
        nd = depth + 1;
        if (nd > depthMax.depth) { depthMax.depth = nd; depthMax.node = node; }
      }
      if (isFn(node)) nd = 0;
      children(node).forEach(function (c) { walkDepth(c, nd, node); });
    })(ast, 0, null);
    if (depthMax.depth >= 5) {
      issues.push({
        key: 'nesting', type: TYPES.SIMPLIFICATION, severity: 'info', line: depthMax.node.loc.start.line, col: 1,
        title: 'You could simplify this.',
        message: 'if/for가 ' + depthMax.depth + '단계나 겹쳐 있어. 안쪽 부분을 함수로 빼거나, 조건이 안 맞으면 먼저 return 하는 방식으로 줄여봐.',
        confidence: 0.7
      });
    }

    walk(ast, function (n, parent) {
      if (n.type === 'Program' || n.type === 'BlockStatement') checkList(n.body);
      if (n.type === 'SwitchCase') checkList(n.consequent);

      // empty functions
      if (isFn(n) && n.body.type === 'BlockStatement' && n.body.body.length === 0) {
        var fname = n.id ? n.id.name : (parent && parent.type === 'VariableDeclarator' && parent.id.name) || (parent && parent.type === 'Property' && parent.key.name) || null;
        if (fname) {
          issues.push({
            key: 'empty:' + fname, type: TYPES.STYLE, severity: 'info', line: n.loc.start.line, col: n.loc.start.column + 1,
            title: 'This function is empty.',
            message: fname + ' 함수 안이 비어 있어. 아직 만드는 중이라면 괜찮아. 호출해도 아무 일도 일어나지 않아.',
            confidence: 0.9
          });
        }
      }

      // long functions
      if (isFn(n) && n.loc.end.line - n.loc.start.line > 50) {
        issues.push({
          key: 'long:' + n.loc.start.line, type: TYPES.SIMPLIFICATION, severity: 'info', line: n.loc.start.line, col: 1,
          title: 'You could simplify this.',
          message: '이 함수가 ' + (n.loc.end.line - n.loc.start.line) + '줄이나 돼. 역할별로 작은 함수 몇 개로 나누면 읽기 쉬워.',
          confidence: 0.6
        });
      }

      // assignment inside a condition: if (x = 5)
      if (/^(IfStatement|WhileStatement|DoWhileStatement)$/.test(n.type) && n.test.type === 'AssignmentExpression' && n.test.operator === '=') {
        var a = n.test, between = code.slice(a.left.end, a.right.start), off = between.indexOf('=');
        var edits = off >= 0 ? [{ start: a.left.end + off, end: a.left.end + off + 1, text: '===' }] : [];
        var iss = {
          key: 'assigncond:' + n.loc.start.line, type: TYPES.POSSIBLE_BUG, severity: 'error', line: n.test.loc.start.line, col: n.test.loc.start.column + 1,
          title: 'I think I found something.',
          message: '조건문 안에서 = (값 넣기)를 썼어. 비교하려면 === 를 써야 해.', confidence: 0.85
        };
        if (edits.length) { var pv = previewFor(code, starts, edits); iss.fix = { kind: 'FIX', label: 'FIX', edits: edits, before: pv.before, after: pv.after }; }
        issues.push(iss);
      }

      // while (true) without break/return
      if ((n.type === 'WhileStatement' || n.type === 'DoWhileStatement' || (n.type === 'ForStatement' && !n.test)) &&
        (!n.test || (n.test.type === 'Literal' && n.test.value === true))) {
        var exits = false;
        (function find(x) {
          if (exits || isFn(x)) return;
          if (/BreakStatement|ReturnStatement|ThrowStatement/.test(x.type)) { exits = true; return; }
          children(x).forEach(find);
        })(n.body);
        if (!exits) {
          issues.push({
            key: 'infinite:' + n.loc.start.line, type: TYPES.POSSIBLE_BUG, severity: 'error', line: n.loc.start.line, col: n.loc.start.column + 1,
            title: 'Check line ' + n.loc.start.line + '.',
            message: '이 반복문은 끝나는 방법(break/return)이 없어서 영원히 돌아. 게임이 멈출 수 있어.', confidence: 0.85
          });
        }
      }

      // for (i = 0; i <= arr.length; i++)
      if (n.type === 'ForStatement' && n.test && n.test.type === 'BinaryExpression' && n.test.operator === '<=' &&
        n.test.right.type === 'MemberExpression' && !n.test.right.computed && n.test.right.property.name === 'length') {
        var bt = code.slice(n.test.left.end, n.test.right.start), o = bt.indexOf('<=');
        var ed = [{ start: n.test.left.end + o, end: n.test.left.end + o + 2, text: '<' }];
        var pv2 = previewFor(code, starts, ed);
        issues.push({
          key: 'offbyone:' + n.loc.start.line, type: TYPES.POSSIBLE_BUG, severity: 'warning', line: n.test.loc.start.line, col: n.test.loc.start.column + 1,
          title: 'I think I found something.',
          message: '<= length 로 하면 마지막 칸을 하나 넘어가서 undefined를 만나. < length 가 맞을 거야.',
          confidence: 0.8, fix: { kind: 'FIX', label: 'FIX', edits: ed, before: pv2.before, after: pv2.after }
        });
      }

      // == and != (suggest strict equality)
      if (n.type === 'BinaryExpression' && (n.operator === '==' || n.operator === '!=') &&
        !(n.right.type === 'Literal' && n.right.value === null) && !(n.left.type === 'Literal' && n.left.value === null)) {
        var bt2 = code.slice(n.left.end, n.right.start), o2 = bt2.indexOf(n.operator);
        var ed2 = [{ start: n.left.end + o2, end: n.left.end + o2 + 2, text: n.operator + '=' }];
        var pv3 = previewFor(code, starts, ed2);
        issues.push({
          key: 'eqeq:' + n.loc.start.line + ':' + n.loc.start.column, type: TYPES.STYLE, severity: 'info', line: n.loc.start.line, col: n.loc.start.column + 1,
          title: 'Small tip.',
          message: n.operator + ' 대신 ' + n.operator + '= 를 쓰면 "5"와 5처럼 종류가 다른 값을 같다고 착각하지 않아.',
          confidence: 0.85, fix: { kind: 'FIX', label: 'FIX', edits: ed2, before: pv3.before, after: pv3.after }
        });
      }

      // x === NaN
      if (n.type === 'BinaryExpression' && /^[!=]==?$/.test(n.operator) &&
        ((n.right.type === 'Identifier' && n.right.name === 'NaN') || (n.left.type === 'Identifier' && n.left.name === 'NaN'))) {
        issues.push({
          key: 'nan:' + n.loc.start.line, type: TYPES.POSSIBLE_BUG, severity: 'warning', line: n.loc.start.line, col: n.loc.start.column + 1,
          title: 'I think I found something.',
          message: 'NaN은 자기 자신과도 같지 않아서 이 비교는 항상 false야. Number.isNaN(값)을 써봐.', confidence: 0.9
        });
      }

      // if (cond) { return true; } else { return false; }  ->  return cond;
      if (n.type === 'IfStatement' && n.alternate && n.test.type === 'BinaryExpression' && /^(===|!==|<|>|<=|>=)$/.test(n.test.operator)) {
        var rv = function (s) {
          if (!s) return undefined;
          if (s.type === 'BlockStatement' && s.body.length === 1) s = s.body[0];
          return s.type === 'ReturnStatement' && s.argument && s.argument.type === 'Literal' && typeof s.argument.value === 'boolean' ? s.argument.value : undefined;
        };
        var t1 = rv(n.consequent), t2 = rv(n.alternate);
        if (t1 !== undefined && t2 !== undefined && t1 !== t2) {
          var testSrc = code.slice(n.test.start, n.test.end);
          var ed3 = [{ start: n.start, end: n.end, text: 'return ' + (t1 ? testSrc : '!(' + testSrc + ')') + ';' }];
          var pv4 = previewFor(code, starts, ed3);
          issues.push({
            key: 'boolret:' + n.loc.start.line, type: TYPES.SIMPLIFICATION, severity: 'info', line: n.loc.start.line, col: n.loc.start.column + 1,
            title: 'You could simplify this.',
            message: '비교 결과가 이미 true/false라서 if 없이 바로 return 할 수 있어.', confidence: 0.9,
            fix: { kind: 'APPLY', label: 'APPLY', edits: ed3, before: pv4.before, after: pv4.after }
          });
        }
      }

      // x = x + 1  ->  x += 1
      if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier' && n.right.type === 'BinaryExpression' &&
        /^[+\-*]$/.test(n.right.operator) && n.right.left.type === 'Identifier' && n.right.left.name === n.left.name) {
        var rhs = code.slice(n.right.right.start, n.right.right.end);
        var ed4 = [{ start: n.start, end: n.end, text: n.left.name + ' ' + n.right.operator + '= ' + rhs }];
        var pv5 = previewFor(code, starts, ed4);
        issues.push({
          key: 'compound:' + n.loc.start.line, type: TYPES.STYLE, severity: 'info', line: n.loc.start.line, col: n.loc.start.column + 1,
          title: 'Small tip.', message: n.left.name + ' ' + n.right.operator + '= ' + rhs + ' 처럼 짧게 쓸 수 있어.', confidence: 0.9,
          fix: { kind: 'APPLY', label: 'APPLY', edits: ed4, before: pv5.before, after: pv5.after }
        });
      }
    });

    // non-consecutive duplicated blocks (3+ identical meaningful lines appearing twice)
    var dupBlock = findDuplicateBlock(code, starts, reportedDupLines);
    if (dupBlock) issues.push(dupBlock);

    return { issues: issues, info: info, parsed: true };
  }

  function removalEdits(code, starts, stmt, declarator) {
    if (stmt.declarations.length === 1) {
      var s = stmt.start, e = stmt.end;
      var ls = posToLoc(starts, s), le = posToLoc(starts, e);
      var lineStart = starts[ls.line - 1];
      var lineEnd = le.line < starts.length ? starts[le.line] : code.length;
      var before = code.slice(lineStart, s), after = code.slice(e, lineEnd);
      if (/^\s*$/.test(before) && /^\s*(\/\/.*)?\n?$/.test(after)) return [{ start: lineStart, end: lineEnd, text: '' }];
      return [{ start: s, end: e, text: '' }];
    }
    var idx = stmt.declarations.indexOf(declarator);
    if (idx < 0) return null;
    if (idx < stmt.declarations.length - 1) return [{ start: declarator.start, end: stmt.declarations[idx + 1].start, text: '' }];
    return [{ start: stmt.declarations[idx - 1].end, end: declarator.end, text: '' }];
  }

  function repeatIssue(code, starts, stmts, declaredNames) {
    var first = stmts[0], last = stmts[stmts.length - 1], count = stmts.length;
    var src = code.slice(first.start, first.end).trim().replace(/;$/, '');
    var indent = indentOf(code, starts, first.loc.start.line);
    var m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*([+-])=\s*(\d+(?:\.\d+)?)$/.exec(src);
    var replacement, fnName = null;
    if (m) {
      var obj = m[1], prop = m[2], op = m[3], amount = parseFloat(m[4]);
      fnName = (prop === 'x' || prop === 'y') ? 'move' + cap(obj) + (prop === 'x' ? '' : 'Y') : 'change' + cap(obj) + cap(prop);
      if (declaredNames.has(fnName)) fnName = null;
      if (fnName) {
        var total = +(amount * count).toFixed(6);
        replacement = 'function ' + fnName + '(amount) {\n' + indent + '  ' + obj + '.' + prop + ' ' + op + '= amount;\n' + indent + '}\n' + indent + fnName + '(' + total + ');';
      }
    }
    if (!replacement) {
      if (/\bi\b/.test(src)) return null;
      replacement = 'for (let i = 0; i < ' + count + '; i++) {\n' + indent + '  ' + src + ';\n' + indent + '}';
    }
    var edits = [{ start: first.start, end: last.end, text: replacement }];
    var pv = previewFor(code, starts, edits);
    return {
      key: 'repeat:' + src, type: TYPES.DUPLICATED_CODE, severity: 'info', line: first.loc.start.line, endLine: last.loc.end.line, col: first.loc.start.column + 1,
      title: 'This code is repeated.',
      message: '같은 줄이 ' + count + '번 반복돼. ' + (fnName ? '함수로 만들면 한 번에 원하는 만큼 움직일 수 있어. (Consider using a function.)' : '반복문으로 바꾸면 더 짧아져.'),
      confidence: 0.85,
      fix: { kind: 'APPLY', label: 'APPLY', edits: edits, before: pv.before, after: pv.after }
    };
  }

  function findDuplicateBlock(code, starts, skipLines) {
    var lines = code.split('\n');
    var norm = lines.map(function (l) { return l.replace(/\/\/.*$/, '').replace(/\s+/g, ''); });
    var meaningful = function (s) { return s.length > 6 && !/^[{}()\[\];,]*$/.test(s); };
    var seen = new Map();
    for (var i = 0; i + 2 < lines.length; i++) {
      if (skipLines.has(i + 1)) continue;
      if (!meaningful(norm[i]) || !meaningful(norm[i + 1]) || !meaningful(norm[i + 2])) continue;
      var k = norm[i] + '\u0001' + norm[i + 1] + '\u0001' + norm[i + 2];
      if (seen.has(k)) {
        var a = seen.get(k);
        if (i - a >= 3) {
          return {
            key: 'dupblock:' + norm[i].slice(0, 40), type: TYPES.DUPLICATED_CODE, severity: 'info', line: i + 1, col: 1,
            title: 'You could turn this into a function.',
            message: 'line ' + (a + 1) + '~' + (a + 3) + '와 line ' + (i + 1) + '~' + (i + 3) + '이 똑같아. 함수로 만들어 두 곳에서 부르면, 고칠 때 한 번만 고치면 돼.',
            confidence: 0.75, preview: { before: lines.slice(i, i + 3).join('\n'), after: 'function doSomething() {\n' + lines.slice(i, i + 3).map(function (l) { return '  ' + l.trim(); }).join('\n') + '\n}' }
          };
        }
      } else seen.set(k, i);
    }
    return null;
  }

  // ---------- 5. HTML ----------
  var VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  function analyzeHTML(code, opts) {
    var issues = [], starts = lineStarts(code), ids = [], idSeen = {};
    var fileNames = opts.fileNames || [];
    var stack = [], re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g, m;
    var rawUntil = null;
    while ((m = re.exec(code))) {
      if (m[0].slice(0, 4) === '<!--') continue;
      var closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '';
      if (rawUntil && !(closing && tag === rawUntil)) continue;
      rawUntil = null;
      var loc = posToLoc(starts, m.index);
      if (!closing) {
        var quoteCount = (attrs.match(/"/g) || []).length;
        if (quoteCount % 2) {
          issues.push({ key: 'html:quote:' + loc.line, type: TYPES.SYNTAX_ERROR, severity: 'error', line: loc.line, col: loc.col, title: 'Something is wrong here.', message: '<' + tag + '> 태그 속성의 따옴표(")가 짝이 안 맞아.', confidence: 0.8 });
        }
        var idm = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs);
        if (idm) {
          if (idSeen[idm[1]]) issues.push({ key: 'html:dupid:' + idm[1], type: TYPES.STYLE, severity: 'warning', line: loc.line, col: loc.col, title: 'Small tip.', message: 'id="' + idm[1] + '"가 두 번 쓰였어. id는 페이지에서 하나만 있어야 해.', confidence: 0.9 });
          idSeen[idm[1]] = true; ids.push(idm[1]);
        }
        var srcm = tag === 'script' ? /\bsrc\s*=\s*["']([^"']+)["']/.exec(attrs) : (tag === 'link' ? /\bhref\s*=\s*["']([^"']+\.css)["']/.exec(attrs) : null);
        if (srcm && !/^(https?:)?\/\//.test(srcm[1]) && fileNames.length && fileNames.indexOf(srcm[1].replace(/^\.\//, '')) < 0) {
          var want = srcm[1].replace(/^\.\//, '');
          var c = closest(want, fileNames);
          var vStart = m.index + m[0].indexOf(srcm[1]);
          var iss = { key: 'html:file:' + want, type: c ? TYPES.TYPO : TYPES.POSSIBLE_BUG, severity: 'error', line: loc.line, col: loc.col, title: c ? 'Typo detected.' : 'Check line ' + loc.line + '.', message: '"' + want + '" 파일이 프로젝트에 없어.' + (c ? ' "' + c.word + '" 아닐까?' : ''), confidence: c ? 0.85 : 0.8 };
          if (c) {
            var ed = [{ start: vStart, end: vStart + srcm[1].length, text: c.word }], pv = previewFor(code, starts, ed);
            iss.word = want; iss.suggestion = c.word;
            iss.fix = { kind: 'FIX', label: 'FIX', edits: ed, before: pv.before, after: pv.after };
          }
          issues.push(iss);
        }
        if (tag === 'script' || tag === 'style') rawUntil = tag;
        if (!VOID_TAGS.has(tag) && m[4] !== '/') stack.push({ tag: tag, line: loc.line, col: loc.col });
      } else {
        if (VOID_TAGS.has(tag)) continue;
        var idx = -1;
        for (var i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { idx = i; break; }
        if (idx < 0) {
          issues.push({ key: 'html:extra:' + tag, type: TYPES.SYNTAX_ERROR, severity: 'warning', line: loc.line, col: loc.col, title: 'Something is wrong here.', message: '</' + tag + '> 를 닫으려는데 열린 <' + tag + '> 가 없어.', confidence: 0.8 });
          continue;
        }
        stack.splice(idx).slice(1).forEach(function (open) {
          if (/^(p|li|td|tr|th|option|html|body|head)$/.test(open.tag)) return;
          issues.push({ key: 'html:unclosed:' + open.tag, type: TYPES.SYNTAX_ERROR, severity: 'warning', line: open.line, col: open.col, title: 'Something is wrong here.', message: 'line ' + open.line + '의 <' + open.tag + '> 태그가 닫히지 않았어.', confidence: 0.75 });
        });
      }
    }
    stack.forEach(function (open) {
      if (/^(p|li|td|tr|th|option|html|body|head)$/.test(open.tag)) return;
      issues.push({ key: 'html:unclosed:' + open.tag, type: TYPES.SYNTAX_ERROR, severity: 'warning', line: open.line, col: open.col, title: 'Something is wrong here.', message: 'line ' + open.line + '의 <' + open.tag + '> 태그가 닫히지 않았어.', confidence: 0.75 });
    });
    return { issues: issues, info: { ids: ids }, parsed: true };
  }

  // ---------- 6. CSS ----------
  var CSS_PROPS = ('color background background-color margin padding border border-radius width height display position top left right bottom ' +
    'font font-size font-family font-weight text-align line-height opacity z-index overflow cursor transform transition animation ' +
    'flex flex-direction justify-content align-items gap grid grid-template-columns box-shadow outline max-width min-width max-height ' +
    'min-height margin-top margin-bottom margin-left margin-right padding-top padding-bottom padding-left padding-right image-rendering ' +
    'user-select content visibility letter-spacing text-decoration white-space box-sizing filter object-fit').split(' ');
  function analyzeCSS(code) {
    var issues = [], starts = lineStarts(code), depth = 0, i, openPos = [];
    var stripped = code.replace(/\/\*[\s\S]*?\*\//g, function (s) { return s.replace(/[^\n]/g, ' '); });
    for (i = 0; i < stripped.length; i++) {
      if (stripped[i] === '{') { depth++; openPos.push(i); }
      else if (stripped[i] === '}') {
        depth--; openPos.pop();
        if (depth < 0) { var l = posToLoc(starts, i); issues.push({ key: 'css:extra', type: TYPES.SYNTAX_ERROR, severity: 'error', line: l.line, col: l.col, title: 'Something is wrong here.', message: '닫는 } 가 하나 더 있어.', confidence: 0.8 }); depth = 0; }
      }
    }
    if (depth > 0) {
      var lo = posToLoc(starts, openPos[openPos.length - 1]);
      var ed = [{ start: code.length, end: code.length, text: (code.endsWith('\n') ? '' : '\n') + '}\n' }];
      var pv = previewFor(code, starts, ed);
      issues.push({ key: 'css:unclosed', type: TYPES.SYNTAX_ERROR, severity: 'error', line: lo.line, col: lo.col, title: 'Something is wrong here.', message: 'line ' + lo.line + '에서 연 { 가 닫히지 않았어.', confidence: 0.7, fix: { kind: 'FIX', label: 'FIX', edits: ed, before: pv.before, after: pv.after } });
    }
    var lines = stripped.split('\n');
    lines.forEach(function (line, idx) {
      var m = /^(\s*)([a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*$/.exec(line);
      var next = (lines[idx + 1] || '').trim();
      if (m && next && !/^}/.test(next)) {
        var at = starts[idx] + line.replace(/\s+$/, '').length;
        var ed2 = [{ start: at, end: at, text: ';' }], pv2 = previewFor(code, starts, ed2);
        issues.push({ key: 'css:semi:' + (idx + 1), type: TYPES.SYNTAX_ERROR, severity: 'warning', line: idx + 1, col: line.length, title: 'Something is wrong here.', message: '줄 끝에 세미콜론(;)이 빠졌어. 다음 줄 속성이 무시될 수 있어.', confidence: 0.8, fix: { kind: 'FIX', label: 'FIX', edits: ed2, before: pv2.before, after: pv2.after } });
      }
      var pm = /^\s*([a-zA-Z-]+)\s*:/.exec(line);
      if (pm && CSS_PROPS.indexOf(pm[1]) < 0 && !/^-/.test(pm[1]) && /[{;]\s*$|^\s/.test(line)) {
        var c = closest(pm[1], CSS_PROPS);
        if (c) {
          var s0 = starts[idx] + line.indexOf(pm[1]);
          var ed3 = [{ start: s0, end: s0 + pm[1].length, text: c.word }], pv3 = previewFor(code, starts, ed3);
          issues.push({ key: 'typo:' + pm[1], type: TYPES.TYPO, severity: 'warning', line: idx + 1, col: line.indexOf(pm[1]) + 1, title: 'Typo detected.', word: pm[1], suggestion: c.word, message: "'" + pm[1] + "' → '" + c.word + "' 아닐까? CSS 속성 이름 철자가 달라.", confidence: 0.85, fix: { kind: 'FIX', label: 'FIX', edits: ed3, before: pv3.before, after: pv3.after } });
        }
      }
    });
    return { issues: issues, info: {}, parsed: true };
  }

  // ---------- public API ----------
  var ORDER = { SYNTAX_ERROR: 0, TYPO: 1, POSSIBLE_BUG: 2, UNUSED_VARIABLE: 3, DUPLICATED_CODE: 4, SIMPLIFICATION: 5, STYLE: 6 };
  var SEV = { error: 0, warning: 1, info: 2 };

  function languageOf(fileName) {
    var ext = (/\.([a-z0-9]+)$/i.exec(fileName || '') || [])[1];
    ext = (ext || '').toLowerCase();
    return ext === 'html' || ext === 'htm' ? 'html' : ext === 'css' ? 'css' : ext === 'js' || ext === 'mjs' ? 'js' : 'text';
  }

  function analyze(code, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var lang = opts.language || languageOf(opts.fileName);
    var res;
    try {
      if (lang === 'js') res = analyzeJS(code, opts);
      else if (lang === 'html') res = analyzeHTML(code, opts);
      else if (lang === 'css') res = analyzeCSS(code, opts);
      else res = { issues: [], info: {}, parsed: true };
    } catch (e) {
      res = { issues: [], info: {}, parsed: false, internalError: String(e && e.message || e) };
    }
    var ignored = new Set(opts.ignored || []);
    var seen = new Set();
    var issues = res.issues.filter(function (i) {
      if (ignored.has(i.key) || seen.has(i.key)) return false;
      seen.add(i.key); return true;
    });
    issues.forEach(function (i) { if (!i.endLine) i.endLine = i.line; i.file = opts.fileName || null; });
    issues.sort(function (a, b) { return (SEV[a.severity] - SEV[b.severity]) || (ORDER[a.type] - ORDER[b.type]) || (a.line - b.line); });
    if (issues.length > 30) issues = issues.slice(0, 30);
    var hasError = issues.some(function (i) { return i.severity === 'error'; });
    var summary = issues.length === 0 ? TYPES.GOOD_CODE : issues[0].type;
    return { issues: issues, info: res.info || {}, parsed: res.parsed, ok: !hasError, summary: summary, language: lang, ms: Date.now() - t0, internalError: res.internalError };
  }

  // Lightweight per-file info used to share globals across project files.
  function fileInfo(code, fileName) {
    var lang = languageOf(fileName);
    if (lang === 'html') { var h = analyzeHTML(code, {}); return { ids: h.info.ids || [], decls: [], refs: [], propNames: [] }; }
    if (lang !== 'js') return { decls: [], refs: [], propNames: [], ids: [] };
    try {
      var r = analyzeJS(code, { isMission: true });
      return { decls: r.info.decls || [], refs: r.info.refs || [], propNames: r.info.propNames || [], ids: [] };
    } catch (e) { return { decls: [], refs: [], propNames: [], ids: [] }; }
  }

  // Parses a JS file and returns ok/error with location, used before running code.
  function checkSyntax(code) {
    try { acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true }); return { ok: true }; }
    catch (e) { return { ok: false, message: e.message, line: e.loc ? e.loc.line : 1, col: e.loc ? e.loc.column + 1 : 1, friendly: friendlyParseMessage(e.message, null) }; }
  }

  // Inserts an iteration guard into every loop so infinite loops cannot freeze the game.
  function instrumentLoops(code, guardName) {
    var ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    var edits = [];
    walk(ast, function (n) {
      if (/^(WhileStatement|DoWhileStatement|ForStatement|ForInStatement|ForOfStatement)$/.test(n.type)) {
        var body = n.body;
        if (body.type === 'BlockStatement') edits.push({ start: body.start + 1, end: body.start + 1, text: guardName + '();' });
        else { edits.push({ start: body.start, end: body.start, text: '{' + guardName + '();' }); edits.push({ start: body.end, end: body.end, text: '}' }); }
      }
    });
    return applyEdits(code, edits);
  }

  // Describe what a given line does in plain language (used by the offline chat).
  function describeLine(code, line) {
    var ast;
    try { ast = acorn.parse(code, { ecmaVersion: 'latest', locations: true }); } catch (e) { return null; }
    var best = null;
    walk(ast, function (n) {
      if (!n.loc || n.loc.start.line > line || n.loc.end.line < line) return false;
      if (/Statement$|Declaration$/.test(n.type) && n.type !== 'BlockStatement' && n.loc.start.line === line) { if (!best) best = n; }
    });
    if (!best) return null;
    var src = function (x) { return code.slice(x.start, x.end); };
    switch (best.type) {
      case 'VariableDeclaration':
        var d = best.declarations[0];
        return d.id.name + '라는 ' + (best.kind === 'const' ? '바뀌지 않는 값(const)' : '변수(' + best.kind + ')') + '를 만들고' + (d.init ? ' ' + src(d.init).slice(0, 40) + ' 값을 넣어.' : ' 아직 값은 없어.');
      case 'FunctionDeclaration':
        return best.id.name + '라는 함수를 만들어. 재료(매개변수)는 ' + (best.params.length ? best.params.map(src).join(', ') : '없어') + '.';
      case 'IfStatement': return '만약 ' + src(best.test) + ' 가 참이면 안쪽 코드를 실행해.';
      case 'ForStatement': return '반복문이야. ' + (best.test ? src(best.test) : '조건 없이') + ' 동안 계속 반복해.';
      case 'WhileStatement': return src(best.test) + ' 가 참인 동안 계속 반복해.';
      case 'ReturnStatement': return best.argument ? '함수를 끝내고 ' + src(best.argument).slice(0, 40) + ' 값을 돌려줘.' : '함수를 여기서 끝내.';
      case 'ExpressionStatement':
        var e = best.expression;
        if (e.type === 'CallExpression') return src(e.callee) + ' 함수를 호출(실행)해.';
        if (e.type === 'AssignmentExpression') return src(e.left) + ' 에 ' + (e.operator === '=' ? '' : e.operator + ' 계산으로 ') + '새 값을 넣어.';
        if (e.type === 'UpdateExpression') return src(e.argument) + ' 값을 1 ' + (e.operator === '++' ? '늘려.' : '줄여.');
        return '값을 계산하는 줄이야.';
      case 'ClassDeclaration': return best.id.name + '라는 클래스(설계도)를 만들어.';
      default: return null;
    }
  }

  return {
    TYPES: TYPES, analyze: analyze, fileInfo: fileInfo, checkSyntax: checkSyntax, instrumentLoops: instrumentLoops,
    describeLine: describeLine, editDistance: editDistance, closest: closest, applyEdits: applyEdits, languageOf: languageOf,
    lineStarts: lineStarts, posToLoc: posToLoc, JS_GLOBALS: JS_GLOBALS
  };
});
