'use strict';
/* CODEMATE server — zero dependencies (Node 18+).
 *   - serves the game (index.html, css/, js/, assets/)
 *   - /api/health and /api/ai/* proxy to the configured AI provider
 * The API key lives only in the server environment (ANTHROPIC_API_KEY); the browser never sees it.
 *
 *   node server/server.js                    # offline analyzer mode (no key needed)
 *   ANTHROPIC_API_KEY=... node server/server.js   # online AI mode
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createProvider } = require('./ai/providers');
const prompts = require('./ai/prompts');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = ['index.html', 'manifest.webmanifest', 'css/', 'js/', 'assets/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const MAX_BODY = 256 * 1024;

function createServer(env) {
  env = env || process.env;
  const provider = createProvider(env);
  const hits = new Map(); // ip -> [timestamps]
  const RATE = Number(env.CODEMATE_RATE_PER_MIN) || 30;

  function send(res, status, obj, headers) {
    const body = JSON.stringify(obj);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
    res.end(body);
  }

  function rateLimited(ip) {
    const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60000);
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > RATE;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, ai: !!provider, provider: provider ? provider.name : null, model: provider ? provider.model : null });
    }
    const routes = { '/api/ai/chat': prompts.chatRequest, '/api/ai/explain': prompts.explainRequest, '/api/ai/analyze': prompts.analyzeRequest };
    const build = routes[pathname];
    if (!build) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
    if (!provider) return send(res, 503, { error: 'AI provider not configured' });
    const ip = req.socket.remoteAddress || 'local';
    if (rateLimited(ip)) return send(res, 429, { error: 'Too many requests, slow down a little.' });
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid body' });
      const result = await provider.complete(build(body));
      return send(res, 200, sanitizeResult(result));
    } catch (e) {
      console.error('[codemate] AI request failed:', e.message);
      return send(res, e.status || 502, { error: e.status === 413 || e.status === 400 ? e.message : 'AI connection unavailable' });
    }
  }

  function sanitizeResult(r) {
    r = r && typeof r === 'object' ? r : {};
    const out = {};
    if (typeof r.reply === 'string') out.reply = r.reply.slice(0, 4000);
    if (Number.isInteger(r.line)) out.line = r.line;
    if (typeof r.confidence === 'number') out.confidence = Math.max(0, Math.min(1, r.confidence));
    if (r.fix && typeof r.fix === 'object' && typeof r.fix.code === 'string' && typeof r.fix.file === 'string') {
      out.fix = { file: r.fix.file.slice(0, 40), code: r.fix.code.slice(0, 200000), summary: String(r.fix.summary || '').slice(0, 300) };
    }
    if (Array.isArray(r.issues)) out.issues = r.issues.slice(0, 5).filter((i) => i && typeof i.message === 'string');
    return out;
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    if (!PUBLIC.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) { res.writeHead(404); return res.end('Not found'); }
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { res.writeHead(400); return res.end(); }
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Server error' }); });
    } else {
      try { serveStatic(req, res, pathname); } catch (e) { res.writeHead(400); res.end(); }
    }
  });
  server.provider = provider;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer(process.env);
  server.listen(port, host, () => {
    const p = server.provider;
    console.log('\n  CODEMATE is running.');
    console.log('  → http://localhost:' + port);
    Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal)
      .forEach((i) => console.log('  → http://' + i.address + ':' + port + '   (phone / tablet on the same Wi-Fi)'));
    console.log('  AI: ' + (p ? 'ONLINE (' + p.name + ', ' + p.model + ')' : 'OFFLINE ANALYZER MODE (set ANTHROPIC_API_KEY to enable online AI)') + '\n');
  });
}

module.exports = { createServer };
