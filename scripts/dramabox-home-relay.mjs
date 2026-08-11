#!/usr/bin/env node
/**
 * DramaBox home app-layer relay.
 * Production curls here over ssh -R; this process re-issues HTTPS with the
 * residential machine's TLS stack (SOCKS CONNECT is not enough — Akamai JA3
 * still sees the datacenter curl fingerprint).
 *
 * POST /v1/forward
 *   Authorization: Bearer <DRAMABOX_RELAY_SECRET>
 *   { url, method?, headers?, body?, timeoutMs? }
 *
 * Bind: 127.0.0.1:18080 (override with DRAMABOX_HOME_RELAY_PORT)
 */
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.DRAMABOX_HOME_RELAY_PORT || 18080);
const HOST = '127.0.0.1';
const SECRET = String(process.env.DRAMABOX_RELAY_SECRET || '').trim();
const MAX_BODY = 4 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  const raw = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': raw.length,
  });
  res.end(raw);
}

async function forwardViaCurl({ url, method, headers, body, timeoutMs }) {
  const args = [
    '-sS',
    '-w',
    '\n__CURL_HTTP_STATUS__:%{http_code}',
    '--compressed',
    '-X',
    method || 'POST',
    url,
    '--max-time',
    String(Math.max(1, Math.ceil((timeoutMs || 15000) / 1000))),
  ];
  for (const [k, v] of Object.entries(headers || {})) {
    if (v == null) continue;
    args.push('-H', `${k}: ${v}`);
  }
  if (body != null && body !== '') {
    args.push('--data-binary', String(body));
  }
  let stdout = '';
  try {
    const result = await execFileAsync('curl.exe', args, {
      encoding: 'utf8',
      maxBuffer: MAX_BODY + 64,
      windowsHide: true,
    });
    stdout = String(result.stdout || '');
  } catch (error) {
    stdout = String(error.stdout || '');
    if (!stdout) {
      throw new Error(String(error.stderr || error.message || error).slice(0, 300));
    }
  }
  const marker = '\n__CURL_HTTP_STATUS__:';
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) throw new Error('curl missing status marker');
  return {
    status: Number(stdout.slice(idx + marker.length).trim()),
    body: stdout.slice(0, idx),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/forward') {
      json(res, 404, { error: 'not found' });
      return;
    }
    if (SECRET) {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Bearer ${SECRET}`) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }
    }
    const raw = await readBody(req);
    const payload = JSON.parse(raw.toString('utf8') || '{}');
    if (!payload.url || typeof payload.url !== 'string') {
      json(res, 400, { error: 'url required' });
      return;
    }
    let host;
    try {
      host = new URL(payload.url).hostname.toLowerCase();
    } catch {
      json(res, 400, { error: 'bad url' });
      return;
    }
    if (
      host !== 'sapi.dramaboxvideo.com' &&
      !host.endsWith('.dramaboxvideo.com')
    ) {
      json(res, 403, { error: 'host not allowed' });
      return;
    }
    const result = await forwardViaCurl(payload);
    json(res, 200, result);
  } catch (error) {
    json(res, 502, { error: String(error.message || error).slice(0, 300) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[dramabox-home-relay] http://${HOST}:${PORT}`);
  if (!SECRET) {
    console.log('[dramabox-home-relay] WARNING: DRAMABOX_RELAY_SECRET empty');
  }
});
