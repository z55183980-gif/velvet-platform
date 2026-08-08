/**
 * One-shot: ReelShort free episodes (paid_start-1) → ONLINE DRAFT.
 * Usage: node supplement-reelshort.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(join(__dirname, '.env'));
loadEnvFile(join(__dirname, '../../services/api/.env'));

const BASE = (process.env.API_BASE_URL || 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const CATEGORY = process.env.POC_CATEGORY_SLUG || 'do_thi';
const EP1 =
  process.argv[2] ||
  'https://www.reelshort.com/episodes/episode-1-i-ll-make-your-daddy-mine-6a50162231243f4ece0229b8-vwamf1tvt7';

async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && typeof json.code === 'number' && json.code !== 0)) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.body = json;
    throw err;
  }
  return json?.data !== undefined ? json.data : json;
}

async function login() {
  const token = (process.env.ADMIN_TOKEN || '').trim();
  if (token) return token;
  const captcha = await api('', '/admin/auth/captcha');
  if (captcha?.captchaRequired) throw new Error('captcha enabled');
  const login = await api('', '/admin/auth/login', {
    method: 'POST',
    body: {
      account: process.env.ADMIN_ACCOUNT || process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD,
      captchaId: '',
      captchaCode: '',
    },
  });
  return login.token;
}

function movieUrlFromEpisode(epUrl) {
  const u = new URL(epUrl);
  // /episodes/episode-1-title-BOOKID-chapterId → /movie/title-BOOKID
  const m = u.pathname.match(/\/episodes\/episode-\d+-(.+)-([a-f0-9]{24})-[a-z0-9]+/i);
  if (!m) throw new Error(`Cannot derive movie URL from ${epUrl}`);
  return `${u.origin}/movie/${m[1]}-${m[2]}`;
}

function fullEpisodesUrlFromEpisode(epUrl) {
  const u = new URL(epUrl);
  const m = u.pathname.match(/\/episodes\/episode-\d+-(.+)-([a-f0-9]{24})-[a-z0-9]+/i);
  if (!m) throw new Error(`Cannot derive full-episodes URL from ${epUrl}`);
  return `${u.origin}/full-episodes/${m[1]}-${m[2]}`;
}

function extractEpisodeLinks(html, origin) {
  const re = /\/episodes\/episode-(\d+)-[^"'\\\s<>]+/g;
  const map = new Map();
  let match;
  while ((match = re.exec(html))) {
    const n = Number(match[1]);
    const path = match[0].replace(/&amp;/g, '&');
    if (!map.has(n)) map.set(n, `${origin}${path}`);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episodeNumber, url]) => ({ episodeNumber, url }));
}

function paidStartFromHtml(html) {
  const m = html.match(/"paid_start"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function bookTitleFromHtml(html) {
  const m = html.match(/"book_title"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  return m[1].replace(/\\"/g, '"').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

async function main() {
  const token = await login();
  const movieUrl = movieUrlFromEpisode(EP1);
  const fullUrl = fullEpisodesUrlFromEpisode(EP1);
  console.log('movie', movieUrl);
  console.log('full-episodes', fullUrl);

  const movieHtml = await (await fetch(movieUrl, { headers: { 'User-Agent': 'VelvetPoc/0.1' } })).text();
  const paidStart = paidStartFromHtml(movieHtml) || 12;
  const titleZh = bookTitleFromHtml(movieHtml) || "I'll Make Your Daddy Mine";
  const freeUntil = paidStart - 1;
  console.log({ titleZh, paidStart, freeUntil });

  // Prefer full-episodes page (free only); fallback movie page filtered
  let fullHtml = '';
  try {
    fullHtml = await (await fetch(fullUrl, { headers: { 'User-Agent': 'VelvetPoc/0.1' } })).text();
  } catch {
    fullHtml = '';
  }
  let eps = extractEpisodeLinks(fullHtml || movieHtml, new URL(movieUrl).origin).filter(
    (e) => e.episodeNumber >= 1 && e.episodeNumber <= freeUntil,
  );
  if (!eps.length) {
    eps = extractEpisodeLinks(movieHtml, new URL(movieUrl).origin).filter(
      (e) => e.episodeNumber >= 1 && e.episodeNumber <= freeUntil,
    );
  }
  console.log(
    'free episodes',
    eps.length,
    eps.map((e) => e.episodeNumber).join(','),
  );
  if (!eps.length) throw new Error('No free episode links found');

  // Create from EP1
  const first = eps[0];
  console.log('import', first.url);
  const created = await api(token, '/admin/ytdlp/import', {
    method: 'POST',
    body: {
      url: first.url,
      categorySlug: CATEGORY,
      titleZh,
      titleEn: titleZh,
      maxEpisodes: 1,
      formatPreference: 'best',
    },
  });
  console.log('created', {
    id: created.id,
    slug: created.slug,
    status: created.status,
    totalEpisodes: created.totalEpisodes,
  });

  const dramaId = created.id;
  const summary = { added: [...(created.episodes || [])], skipped: [], errors: [] };

  for (const ep of eps.slice(1)) {
    process.stdout.write(`append EP${ep.episodeNumber}… `);
    try {
      const r = await api(token, `/admin/dramas/${dramaId}/ytdlp/append`, {
        method: 'POST',
        body: { url: ep.url, maxEpisodes: 1, formatPreference: 'best' },
      });
      console.log(
        `added=${r.added?.length || 0} skipped=${r.skipped?.length || 0} errors=${r.errors?.length || 0}`,
      );
      summary.added.push(...(r.added || []));
      summary.skipped.push(...(r.skipped || []));
      summary.errors.push(...(r.errors || []));
    } catch (e) {
      console.log('FAIL', e.message);
      summary.errors.push({ episodeNumber: ep.episodeNumber, error: e.message, body: e.body });
    }
  }

  console.log('\n── Done ──');
  console.log(
    JSON.stringify(
      {
        dramaId,
        titleZh,
        freeUntil,
        addedCount: summary.added.length,
        skipped: summary.skipped,
        errors: summary.errors,
        note: 'DRAFT only. Old single-ep drama 24 left untouched.',
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
