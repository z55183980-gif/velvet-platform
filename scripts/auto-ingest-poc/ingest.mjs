#!/usr/bin/env node
/**
 * Velvet auto-ingest POC
 * Path A: yt-dlp probe → import
 * Path B: fetch HTML → OpenAI extract → POST /admin/dramas/online
 *
 * Always creates DRAFT. Never calls /online (publish).
 * ONLINE go-live: admin 提交审核 → 审核通过.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── env / args ─────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(join(__dirname, '.env'));
loadEnvFile(join(__dirname, '../../services/api/.env'));

function parseArgs(argv) {
  const out = {
    url: '',
    category: process.env.POC_CATEGORY_SLUG || 'urban',
    maxEpisodes: Number(process.env.POC_MAX_EPISODES || 20) || 20,
    forcePath: '', // 'a' | 'b' | ''
    dryRun: false,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--url') out.url = String(argv[++i] || '').trim();
    else if (a === '--category') out.category = String(argv[++i] || '').trim();
    else if (a === '--max-episodes') out.maxEpisodes = Number(argv[++i]) || out.maxEpisodes;
    else if (a === '--force-path') out.forcePath = String(argv[++i] || '').trim().toLowerCase();
    else if (a === '--model') out.model = String(argv[++i] || out.model).trim();
    else if (!a.startsWith('-') && !out.url) out.url = a.trim();
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node scripts/auto-ingest-poc/ingest.mjs --url <pageUrl> [options]

Options:
  --category <slug>     Default: urban (or POC_CATEGORY_SLUG)
  --max-episodes <n>    Cap episodes (default 20)
  --force-path a|b      Skip auto fallback
  --dry-run             Probe/extract only; do not create drama
  --model <name>        OpenAI model (default gpt-4o-mini)
  -h, --help

Env (scripts/auto-ingest-poc/.env):
  API_BASE_URL          e.g. http://127.0.0.1:3001/api/v1
  ADMIN_TOKEN           Prefer: paste JWT from admin session
  ADMIN_ACCOUNT         Fallback login (needs captcha disabled)
  ADMIN_PASSWORD
  OPENAI_API_KEY        Required for Path B
  OPENAI_BASE_URL       Optional compatible gateway
  OPENAI_MODEL
  POC_CATEGORY_SLUG
`);
}

// ─── helpers ────────────────────────────────────────────────

function log(step, msg, extra) {
  const ts = new Date().toISOString().slice(11, 19);
  if (extra !== undefined) console.log(`[${ts}] ${step} ${msg}`, extra);
  else console.log(`[${ts}] ${step} ${msg}`);
}

function fail(msg, err) {
  console.error(`\n✖ ${msg}`);
  if (err) {
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    else if (err.message) console.error(err.message);
    else console.error(err);
  }
  process.exit(1);
}

function pocExternalRef(pageUrl) {
  let host = 'unknown';
  let pathKey = pageUrl;
  try {
    const u = new URL(pageUrl);
    host = u.hostname.replace(/^www\./, '');
    pathKey = u.pathname + u.search;
  } catch {
    /* keep raw */
  }
  const hash = createHash('sha256').update(pathKey).digest('hex').slice(0, 16);
  return `poc:${host}:${hash}`;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function apiRequest(baseUrl, token, path, { method = 'GET', body } = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json?.data !== undefined ? json.data : json;
}

async function ensureToken(baseUrl, argsEnv) {
  if (argsEnv.token) {
    log('auth', 'using ADMIN_TOKEN');
    return argsEnv.token;
  }
  if (!argsEnv.account || !argsEnv.password) {
    fail('Set ADMIN_TOKEN, or ADMIN_ACCOUNT + ADMIN_PASSWORD (with captcha disabled)');
  }
  const captcha = await apiRequest(baseUrl, '', '/admin/auth/captcha');
  if (captcha?.captchaRequired) {
    fail(
      'Admin captcha is enabled. Paste ADMIN_TOKEN from browser, or set AUTH_ADMIN_CAPTCHA_DISABLED=true on API',
    );
  }
  const login = await apiRequest(baseUrl, '', '/admin/auth/login', {
    method: 'POST',
    body: {
      account: argsEnv.account,
      password: argsEnv.password,
      captchaId: '',
      captchaCode: '',
    },
  });
  if (!login?.token) fail('Login succeeded but no token returned', login);
  log('auth', `logged in as ${login.admin?.username || argsEnv.account}`);
  return login.token;
}

// ─── Path A: yt-dlp ─────────────────────────────────────────

async function pathA(baseUrl, token, { url, category, maxEpisodes, dryRun }) {
  const t0 = Date.now();
  log('path-a', 'probe…', url);
  const probe = await apiRequest(baseUrl, token, '/admin/ytdlp/probe', {
    method: 'POST',
    body: { url },
  });
  const epCount = Array.isArray(probe?.episodes) ? probe.episodes.length : 0;
  log('path-a', `probe ok: kind=${probe.kind} extractor=${probe.extractor} episodes=${epCount}`, {
    title: probe.title,
    id: probe.id,
  });

  if (dryRun) {
    return {
      path: 'a',
      dryRun: true,
      probe,
      elapsedMs: Date.now() - t0,
    };
  }

  log('path-a', 'import DRAFT…');
  const created = await apiRequest(baseUrl, token, '/admin/ytdlp/import', {
    method: 'POST',
    body: {
      url,
      categorySlug: category,
      titleZh: probe.title || undefined,
      maxEpisodes,
      formatPreference: 'best',
    },
  });
  return {
    path: 'a',
    dryRun: false,
    probe,
    created,
    elapsedMs: Date.now() - t0,
  };
}

// ─── Path B: HTML + OpenAI ──────────────────────────────────

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleZh: { type: 'string' },
    titleEn: { type: 'string' },
    coverUrl: { type: 'string' },
    descriptionZh: { type: 'string' },
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          episodeNumber: { type: 'integer' },
          title: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
        required: ['episodeNumber', 'title', 'sourceUrl'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['titleZh', 'titleEn', 'coverUrl', 'descriptionZh', 'episodes', 'notes'],
};

function openaiChatCompletionsUrl() {
  const raw = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  return raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`;
}

async function openaiExtract({ apiKey, model, pageUrl, htmlText }) {
  const truncated = htmlText.slice(0, 80_000);
  const endpoint = openaiChatCompletionsUrl();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'drama_extract',
          strict: true,
          schema: EXTRACT_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'Extract short-drama metadata from a source page. ' +
            'Return playable episode media URLs when present (m3u8/mp4/direct video). ' +
            'If only episode page links exist, put those in sourceUrl and explain in notes. ' +
            'episodeNumber must be contiguous starting at 1. Use empty string when unknown.',
        },
        {
          role: 'user',
          content: `Page URL: ${pageUrl}\n\nPage text:\n${truncated}`,
        },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
    err.body = json;
    throw err;
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  return JSON.parse(content);
}

async function pathB(baseUrl, token, { url, category, maxEpisodes, dryRun, model, openaiKey }) {
  const t0 = Date.now();
  if (!openaiKey) fail('Path B needs OPENAI_API_KEY');

  log('path-b', 'fetch HTML…');
  const pageRes = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; VelvetAutoIngestPoc/0.1; +https://velvetmovie.space)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!pageRes.ok) fail(`Fetch page failed: HTTP ${pageRes.status}`);
  const rawHtml = await pageRes.text();
  const text = stripHtml(rawHtml);
  log('path-b', `fetched ${rawHtml.length} html chars → ${text.length} text chars`);

  log('path-b', `OpenAI extract (${model})…`);
  const extracted = await openaiExtract({
    apiKey: openaiKey,
    model,
    pageUrl: url,
    htmlText: text,
  });

  let episodes = Array.isArray(extracted.episodes) ? extracted.episodes : [];
  episodes = episodes
    .filter((e) => e && String(e.sourceUrl || '').trim())
    .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
    .slice(0, maxEpisodes)
    .map((e, i) => ({
      episodeNumber: i + 1,
      title: String(e.title || `EP${i + 1}`).trim(),
      sourceUrl: String(e.sourceUrl).trim(),
    }));

  log('path-b', `extracted title="${extracted.titleZh}" episodes=${episodes.length}`, {
    notes: extracted.notes || '',
  });

  if (episodes.length === 0) {
    fail('Path B extracted 0 episodes with sourceUrl', extracted);
  }

  const payload = {
    titleZh: String(extracted.titleZh || '').trim() || 'Untitled POC',
    titleEn: String(extracted.titleEn || '').trim() || undefined,
    descriptionZh: String(extracted.descriptionZh || '').trim() || undefined,
    coverUrl: String(extracted.coverUrl || '').trim() || undefined,
    categorySlug: category,
    externalRef: pocExternalRef(url),
    relaxedPlayUrl: true,
    status: 'DRAFT',
    episodes: episodes.map((e) => ({
      episodeNumber: e.episodeNumber,
      title: e.title,
      sourceUrl: e.sourceUrl,
    })),
  };

  if (dryRun) {
    return {
      path: 'b',
      dryRun: true,
      extracted,
      payloadPreview: {
        ...payload,
        episodes: payload.episodes.slice(0, 3),
        episodeCount: payload.episodes.length,
      },
      elapsedMs: Date.now() - t0,
    };
  }

  log('path-b', `create online DRAFT externalRef=${payload.externalRef}`);
  try {
    const created = await apiRequest(baseUrl, token, '/admin/dramas/online', {
      method: 'POST',
      body: payload,
    });
    return {
      path: 'b',
      dryRun: false,
      extracted,
      created,
      elapsedMs: Date.now() - t0,
    };
  } catch (err) {
    // Dedup conflict → treat as soft success for POC
    if (err.status === 409 || err.body?.code === 409 || /externalRef|已存在|conflict/i.test(err.message)) {
      log('path-b', 'dedup/conflict — drama may already exist', err.body || err.message);
      return {
        path: 'b',
        dryRun: false,
        dedup: true,
        extracted,
        error: err.body || err.message,
        elapsedMs: Date.now() - t0,
      };
    }
    throw err;
  }
}

// ─── main ───────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.url) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }

  const baseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:3001/api/v1').replace(/\/$/, '');
  const envAuth = {
    token: (process.env.ADMIN_TOKEN || process.env.VELVET_ADMIN_TOKEN || '').trim(),
    account: (process.env.ADMIN_ACCOUNT || process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim(),
    password: (process.env.ADMIN_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim(),
  };
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();

  console.log('\nVelvet auto-ingest POC');
  console.log('─'.repeat(40));
  log('cfg', `api=${baseUrl}`);
  log('cfg', `url=${opts.url}`);
  log('cfg', `category=${opts.category} maxEpisodes=${opts.maxEpisodes} dryRun=${opts.dryRun}`);

  const token = await ensureToken(baseUrl, envAuth);
  const force = opts.forcePath;

  let result;
  if (force === 'b') {
    result = await pathB(baseUrl, token, { ...opts, openaiKey });
  } else {
    try {
      result = await pathA(baseUrl, token, opts);
    } catch (err) {
      if (force === 'a') fail('Path A failed (--force-path a)', err);
      log('path-a', `failed → fallback Path B: ${err.message}`);
      result = await pathB(baseUrl, token, { ...opts, openaiKey });
    }
  }

  console.log('\n── Result ──');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n✓ done in ${result.elapsedMs}ms via path-${result.path}${result.dryRun ? ' (dry-run)' : ''}`);
  console.log('Note: DRAFT only — ONLINE: 提交审核 → 审核通过.\n');
}

main().catch((err) => fail('Unhandled error', err));
