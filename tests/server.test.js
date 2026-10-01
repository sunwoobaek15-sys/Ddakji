'use strict';
// Backend tests: static serving, health, AI routes with the mock provider and without any provider.
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server/server.js');

function listen(env) {
  return new Promise((resolve) => {
    const s = createServer(env);
    s.listen(0, '127.0.0.1', () => resolve({ s, base: 'http://127.0.0.1:' + s.address().port }));
  });
}

test('serves the game and blocks non-public files', async () => {
  const { s, base } = await listen({});
  try {
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/js/analyzer.js')).status, 200);
    assert.strictEqual((await fetch(base + '/server/server.js')).status, 404);
    assert.strictEqual((await fetch(base + '/package.json')).status, 404);
    assert.strictEqual((await fetch(base + '/js/%2e%2e/server/server.js')).status, 404);
  } finally { s.close(); }
});

test('without a provider: health reports offline and AI routes return 503', async () => {
  const { s, base } = await listen({});
  try {
    const h = await (await fetch(base + '/api/health')).json();
    assert.deepStrictEqual([h.ok, h.ai], [true, false]);
    const r = await fetch(base + '/api/ai/chat', { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 503);
  } finally { s.close(); }
});

test('with the mock provider: chat, explain, analyze work; failures map to 503', async () => {
  const { s, base } = await listen({ CODEMATE_AI_PROVIDER: 'mock' });
  try {
    const h = await (await fetch(base + '/api/health')).json();
    assert.strictEqual(h.ai, true);
    const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const c = await (await post('/api/ai/chat', { message: 'hi', code: 'let a = 1;', file: 'game.js' })).json();
    assert.match(c.reply, /mock/);
    const e = await (await post('/api/ai/explain', { code: 'x();', error: { name: 'ReferenceError', message: 'x is not defined', line: 1 } })).json();
    assert.ok(e.reply);
    const a = await (await post('/api/ai/analyze', { code: 'let a = 1;' })).json();
    assert.ok(Array.isArray(a.issues));
    const f = await post('/api/ai/chat', { message: 'FAIL_PLEASE' });
    assert.strictEqual(f.status, 503);
    const bad = await fetch(base + '/api/ai/chat', { method: 'POST', body: '{not json' });
    assert.strictEqual(bad.status, 400);
  } finally { s.close(); }
});

test('rate limiting kicks in', async () => {
  const { s, base } = await listen({ CODEMATE_AI_PROVIDER: 'mock', CODEMATE_RATE_PER_MIN: '3' });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(base + '/api/ai/chat', { method: 'POST', body: '{"message":"hi"}' })).status);
    assert.ok(codes.includes(429));
  } finally { s.close(); }
});

test('prompts clamp and shape the request', () => {
  const prompts = require('../server/ai/prompts.js');
  const req = prompts.chatRequest({ message: 'x'.repeat(5000), code: 'let a;', partnerName: '<script>', history: [{ role: 'ai', text: 'hello' }, { role: 'user', text: 'q' }] });
  assert.strictEqual(req.messages[0].role, 'user');
  assert.ok(req.messages[req.messages.length - 1].content.length < 40000);
  assert.ok(!/<script>/.test(req.system));
});

test('Anthropic provider: request shape, JSON parsing, refusal and error mapping', async () => {
  const { AnthropicProvider } = require('../server/ai/providers.js');
  const realFetch = global.fetch;
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  try {
    const p = new AnthropicProvider({ apiKey: 'test-key' });
    global.fetch = async (url, init) => { calls.push({ url, init }); return reply(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"reply":"안녕","line":3,"confidence":0.8,"fix":null}' }] }); };
    const out = await p.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object' } });
    assert.deepStrictEqual(out, { reply: '안녕', line: 3, confidence: 0.8, fix: null });
    const { url, init } = calls[0];
    const body = JSON.parse(init.body);
    assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(init.headers['x-api-key'], 'test-key');
    assert.strictEqual(init.headers['anthropic-version'], '2023-06-01');
    assert.strictEqual(body.model, 'claude-opus-5-5');
    assert.strictEqual(body.fallbacks, 'default');
    assert.deepStrictEqual(body.output_config.format, { type: 'json_schema', schema: { type: 'object' } });
    assert.ok(!('thinking' in body) && !('temperature' in body));

    global.fetch = async () => reply(200, { stop_reason: 'refusal', content: [] });
    assert.strictEqual((await p.complete({ system: 's', messages: [] })).confidence, 0);

    global.fetch = async () => reply(429, { error: { message: 'rate limited' } });
    await assert.rejects(p.complete({ system: 's', messages: [] }), (e) => e.status === 503);
  } finally { global.fetch = realFetch; }
});
