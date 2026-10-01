'use strict';
/* Prompts and JSON schemas for the coding partner. Inputs are validated/clamped before use. */

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function persona(partnerName, stage) {
  const tone = [
    'The player is a beginner. Explain simply, one idea at a time, no jargon.',
    'The player is improving. Keep explanations short and encourage them.',
    'The player is experienced now. Be brief; skip basics unless asked.'
  ][stage] || '';
  return [
    `You are ${partnerName}, the AI coding partner character in the game CODEMATE.`,
    'You sit next to the player with a small laptop and help them write JavaScript for small browser games.',
    'Always reply in Korean, casually and warmly, in 1-4 short sentences. Mention line numbers when relevant ("line 12").',
    'Never claim to have real feelings; you are a game character.',
    'Do not just hand over full answers to mission exercises: give the next small step unless the player explicitly asks for the fix.',
    tone
  ].join('\n');
}

function codeBlock(body) {
  const issues = Array.isArray(body.issues) ? body.issues.slice(0, 10).map((i) => `- line ${Number(i.line) || '?'} [${str(i.type, 30)}] ${str(i.message, 200)}`).join('\n') : '';
  const err = body.lastError && typeof body.lastError === 'object'
    ? `Last runtime error: ${str(body.lastError.name, 40)}: ${str(body.lastError.message, 300)} (${str(body.lastError.file, 60)}:${Number(body.lastError.line) || '?'})` : '';
  const mission = body.mission && typeof body.mission === 'object' ? `Current mission: ${str(body.mission.title, 100)} — ${str(body.mission.goal, 300)}` : '';
  const files = Array.isArray(body.files) ? body.files.slice(0, 30).map((f) => str(f, 40)).join(', ') : '';
  const numbered = str(body.code, 30000).split('\n').map((l, i) => String(i + 1).padStart(3) + '| ' + l).join('\n');
  return [
    `Project files: ${files}`,
    `Open file: ${str(body.file, 60)}`,
    '<code>', numbered, '</code>',
    issues ? 'Local analyzer findings:\n' + issues : 'Local analyzer findings: none',
    err, mission
  ].filter(Boolean).join('\n');
}

const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    line: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    confidence: { type: 'number' },
    fix: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          properties: { file: { type: 'string' }, code: { type: 'string' }, summary: { type: 'string' } },
          required: ['file', 'code', 'summary']
        }
      ]
    }
  },
  required: ['reply', 'line', 'confidence', 'fix']
};

const ANALYZE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { line: { type: 'integer' }, type: { type: 'string', enum: ['POSSIBLE_BUG', 'STYLE'] }, message: { type: 'string' }, confidence: { type: 'number' } },
        required: ['line', 'type', 'message', 'confidence']
      }
    }
  },
  required: ['issues']
};

const EXPLAIN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { reply: { type: 'string' }, line: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, confidence: { type: 'number' } },
  required: ['reply', 'line', 'confidence']
};

function stageOf(body) { const s = Number(body.stage); return s >= 0 && s <= 2 ? s : 0; }
function nameOf(body) { return str(body.partnerName, 16).replace(/[^\w가-힣 -]/g, '') || 'CLAUDE'; }

function chatRequest(body) {
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const messages = [];
  history.forEach((h) => {
    const role = h && h.role === 'user' ? 'user' : 'assistant';
    const text = str(h && h.text, 1500);
    if (!text) return;
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += '\n' + text;
    else messages.push({ role, content: text });
  });
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const question = str(body.message, 2000);
  const userTurn = codeBlock(body) + '\n\nPlayer: ' + question;
  if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n\n' + userTurn;
  else messages.push({ role: 'user', content: userTurn });
  return {
    system: persona(nameOf(body), stageOf(body)) + '\n\n' + [
      'Respond as JSON matching the schema.',
      '"reply": what you say to the player.',
      '"line": the most relevant line number in the open file, or null.',
      '"confidence": 0..1, how sure you are.',
      '"fix": only when the player asks you to fix/change code AND you are confident. Then give the COMPLETE new content of the file in "code" (same file name in "file") and a one-line "summary". Otherwise null.'
    ].join('\n'),
    messages,
    schema: CHAT_SCHEMA,
    task: 'chat'
  };
}

function explainRequest(body) {
  const e = body.error && typeof body.error === 'object' ? body.error : {};
  return {
    system: persona(nameOf(body), stageOf(body)) + '\nExplain the runtime error to the player: what happened, which line, and the next step to fix it. JSON only.',
    messages: [{ role: 'user', content: codeBlock(body) + `\n\nRuntime error: ${str(e.name, 40)}: ${str(e.message, 400)} at ${str(e.file, 60)}:${Number(e.line) || '?'}` }],
    schema: EXPLAIN_SCHEMA,
    task: 'explain'
  };
}

function analyzeRequest(body) {
  return {
    system: persona(nameOf(body), stageOf(body)) + '\nReview the open file for real bugs or confusing code that the local analyzer did not already report. Return at most 3 issues; return an empty list if the code is fine. JSON only.',
    messages: [{ role: 'user', content: codeBlock(body) }],
    schema: ANALYZE_SCHEMA,
    task: 'analyze'
  };
}

module.exports = { chatRequest, explainRequest, analyzeRequest };
