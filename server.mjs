import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const VISION_BASE = (process.env.VISION_API_BASE || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const VISION_MODEL = process.env.VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const VISION_KEY = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readBody(req, limit = 24 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function visionProxy(req, res) {
  if (!VISION_KEY) {
    return json(res, 503, {
      error: '未配置视觉服务。设置环境变量 VISION_API_KEY 后重启 server.mjs；或在上方填写 API Key 使用浏览器直连。',
    });
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return json(res, 400, { error: `请求体不是合法 JSON：${e.message}` });
  }
  const { image, prompt } = payload || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return json(res, 400, { error: '缺少 image data URL' });
  }
  try {
    const upstream = await fetch(`${VISION_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VISION_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt || '识别麻将牌，只输出 JSON {"tiles":[...]}。m=万,p=筒,s=条,z5=红中。' },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
      }),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json(res, 502, { error: `上游视觉接口 ${upstream.status}`, detail: text.slice(0, 1000) });
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content ?? '';
    return json(res, 200, { content });
  } catch (e) {
    return json(res, 502, { error: `视觉代理失败：${e.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, vision: Boolean(VISION_KEY), model: VISION_MODEL });
  if (url.pathname === '/api/vision' && req.method === 'POST') return visionProxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return send(res, 403, 'Forbidden');
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) return send(res, 403, 'Forbidden');
    const ext = path.extname(filePath).toLowerCase();
    const body = req.method === 'HEAD' ? '' : await fs.promises.readFile(filePath);
    send(res, 200, body, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(stat.size),
    });
  } catch {
    send(res, 404, 'Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`牌理 · Mahjong Lab`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  vision proxy: ${VISION_KEY ? `enabled (${VISION_MODEL})` : 'disabled (set VISION_API_KEY)'}`);
  console.log('  仅用于合法麻将娱乐与策略研究。');
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
