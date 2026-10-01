'use strict';
/* AI provider abstraction. Every provider implements:
 *   name, model, complete({ system, messages, schema, maxTokens }) -> Promise<object>  (parsed JSON)
 * Swap providers with CODEMATE_AI_PROVIDER (anthropic | mock). */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

class AnthropicProvider {
  constructor(opts) {
    this.name = 'anthropic';
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'claude-opus-5-5';
    this.effort = opts.effort || 'low'; // chat-style game replies: keep them fast
    this.timeoutMs = opts.timeoutMs || 60000;
  }

  async complete({ system, messages, schema, maxTokens }) {
    const body = {
      model: this.model,
      max_tokens: maxTokens || 16000,
      system,
      messages,
      // If a safety classifier declines, Anthropic retries on its recommended fallback model.
      fallbacks: 'default',
      output_config: { effort: this.effort }
    };
    if (schema) body.output_config.format = { type: 'json_schema', schema };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'server-side-fallback-2026-07-01'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      const err = new Error('AI provider error: ' + msg);
      err.status = res.status >= 500 || res.status === 429 ? 503 : 502;
      throw err;
    }
    if (data.stop_reason === 'refusal') {
      return { reply: '그건 내가 도와줄 수 없는 내용이야. 코드에 대한 다른 질문을 해줘.', confidence: 0, fix: null, line: null, issues: [] };
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return JSON.parse(text);
    } catch (e) {
      return { reply: text.slice(0, 2000) || '...', confidence: 0.3, fix: null, line: null, issues: [] };
    }
  }
}

/* Deterministic provider for tests and demos without an API key. */
class MockProvider {
  constructor() { this.name = 'mock'; this.model = 'mock-partner'; }
  async complete({ messages, task }) {
    const last = messages[messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : '';
    if (task === 'analyze') return { issues: [{ line: 1, type: 'STYLE', message: '[mock] 함수 이름을 조금 더 구체적으로 지어봐.', confidence: 0.5 }] };
    if (task === 'explain') return { reply: '[mock] 오류를 봤어. 해당 줄을 확인해봐.', line: null, confidence: 0.6 };
    if (/FAIL_PLEASE/.test(text)) throw Object.assign(new Error('mock failure'), { status: 503 });
    return { reply: '[mock] 질문 잘 받았어!', confidence: 0.6, fix: null, line: null };
  }
}

function createProvider(env) {
  const kind = (env.CODEMATE_AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'none')).toLowerCase();
  if (kind === 'mock') return new MockProvider();
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.CODEMATE_MODEL, effort: env.CODEMATE_EFFORT });
  }
  return null;
}

module.exports = { createProvider, AnthropicProvider, MockProvider };
