import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { BizCode, BizException } from '../common/biz.exception';
import { VIDEO_EXT } from './local-import.util';
import {
  defaultYtdlpBinDir,
  ensureYtdlpBinary,
  ytdlpLocalFileName,
} from './ytdlp-bootstrap.util';

const execFileAsync = promisify(execFile);

export type YtdlpFormatPreference = 'best_hls' | 'best_mp4' | 'best';

/** Optional per-call auth; secrets must stay server-side. */
export type YtdlpAuthOverride = {
  /** Absolute path under cookies dir, or basename like `reelshort.com.txt` */
  cookiesFile?: string;
  /** Sent as Authorization: Bearer … */
  bearerToken?: string;
  /** Extra yt-dlp --add-header lines, e.g. ["Cookie: a=b", "X-Api-Key: k"] */
  headers?: string[];
};

export type YtdlpProbeEpisode = {
  index: number;
  id: string;
  title: string;
  durationSec?: number;
  /** 单集页链接；播放列表无独立页时指向列表页，并配合 playlistIndex */
  webpageUrl: string;
  playlistIndex?: number;
  candidateCount: number;
};

export type YtdlpProbeResult = {
  extractor: string;
  id: string;
  title: string;
  coverUrl?: string;
  description?: string;
  webpageUrl: string;
  kind: 'single' | 'playlist';
  episodes: YtdlpProbeEpisode[];
};

export type YtdlpBinSource = 'env' | 'bundled' | 'path' | 'auto_download' | null;

/**
 * 本地 yt-dlp 解析 Provider：无第三方 API Key。
 * 优先使用已安装 / 捆绑二进制；缺失时可选自动从 GitHub 下载到 STORAGE_ROOT/bin。
 * 配置：YTDLP_BIN、YTDLP_BIN_DIR、YTDLP_AUTO_INSTALL、YTDLP_TIMEOUT_MS、YTDLP_ENABLED
 */
@Injectable()
export class YtdlpProvider implements OnModuleInit {
  private readonly logger = new Logger(YtdlpProvider.name);
  private binPath: string | null | undefined;
  private binSource: YtdlpBinSource = null;
  private versionCache: string | null = null;
  private ensurePromise: Promise<string | null> | null = null;
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // 不阻塞 Nest 启动；后台拉齐二进制，status/probe 时也会 await ensure
    this.ensureReady().catch((e) => {
      this.lastError = e?.message || String(e);
      this.logger.warn(`yt-dlp bootstrap deferred fail: ${this.lastError}`);
    });
  }

  private enabled() {
    const v = String(this.config.get<string>('YTDLP_ENABLED') ?? 'true').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
  }

  private autoInstall() {
    const v = String(this.config.get<string>('YTDLP_AUTO_INSTALL') ?? 'true').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
  }

  private timeoutMs() {
    const n = Number(this.config.get<string>('YTDLP_TIMEOUT_MS') || 90_000);
    return Number.isFinite(n) && n >= 5_000 ? n : 90_000;
  }

  private downloadTimeoutMs() {
    const n = Number(this.config.get<string>('YTDLP_DOWNLOAD_TIMEOUT_MS') || 1_800_000);
    return Number.isFinite(n) && n >= 30_000 ? n : 1_800_000;
  }

  private storageRoot() {
    return (
      this.config.get<string>('STORAGE_ROOT')?.trim() ||
      path.join(process.cwd(), 'storage')
    );
  }

  private bundledBinPath() {
    const dir =
      this.config.get<string>('YTDLP_BIN_DIR')?.trim() ||
      defaultYtdlpBinDir(this.storageRoot());
    return path.join(dir, ytdlpLocalFileName());
  }

  /** 探测或自动安装，缓存可用二进制路径 */
  async ensureReady(): Promise<string | null> {
    if (this.binPath !== undefined) return this.binPath;
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.detectOrInstall().finally(() => {
      this.ensurePromise = null;
    });
    return this.ensurePromise;
  }

  private async probeCandidate(
    bin: string,
    source: YtdlpBinSource,
  ): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(bin, ['--version'], {
        timeout: 8_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      this.binPath = bin;
      this.binSource = source;
      this.versionCache = String(stdout || '').trim().split(/\r?\n/)[0] || null;
      this.lastError = null;
      this.logger.log(`yt-dlp ready: ${bin} (${this.versionCache}) [${source}]`);
      return bin;
    } catch {
      return null;
    }
  }

  private async detectOrInstall(): Promise<string | null> {
    if (!this.enabled()) {
      this.binPath = null;
      this.binSource = null;
      return null;
    }

    const envBin = this.config.get<string>('YTDLP_BIN')?.trim();
    const bundled = this.bundledBinPath();
    const candidates: Array<{ bin: string; source: YtdlpBinSource }> = [
      ...(envBin ? [{ bin: envBin, source: 'env' as const }] : []),
      { bin: bundled, source: 'bundled' },
      { bin: 'yt-dlp', source: 'path' },
      { bin: 'yt-dlp.exe', source: 'path' },
      { bin: '/usr/local/bin/yt-dlp', source: 'path' },
      { bin: '/usr/bin/yt-dlp', source: 'path' },
      { bin: '/opt/homebrew/bin/yt-dlp', source: 'path' },
    ];

    for (const c of candidates) {
      const ok = await this.probeCandidate(c.bin, c.source);
      if (ok) return ok;
    }

    if (this.autoInstall()) {
      try {
        const dir = path.dirname(bundled);
        const dest = await ensureYtdlpBinary({
          binDir: dir,
          timeoutMs: Math.max(this.timeoutMs(), 120_000),
        });
        const ok = await this.probeCandidate(dest, 'auto_download');
        if (ok) return ok;
        this.lastError = 'downloaded binary failed --version';
      } catch (e: any) {
        this.lastError = e?.message || String(e);
        this.logger.warn(`yt-dlp auto-install failed: ${this.lastError}`);
      }
    }

    this.binPath = null;
    this.binSource = null;
    this.logger.warn(
      'yt-dlp not available — set YTDLP_BIN, preinstall in image, or enable YTDLP_AUTO_INSTALL',
    );
    return null;
  }

  /** @deprecated use ensureReady — kept as alias for callers */
  async detectBin(): Promise<string | null> {
    return this.ensureReady();
  }

  async status() {
    const bin = await this.ensureReady();
    const cookiesDir = this.cookiesDir();
    let hostCookieFiles: string[] = [];
    try {
      if (fs.existsSync(cookiesDir)) {
        hostCookieFiles = fs
          .readdirSync(cookiesDir)
          .filter((f) => f.endsWith('.txt') && !f.startsWith('.'));
      }
    } catch {
      hostCookieFiles = [];
    }
    const globalCookies = this.globalCookiesFile();
    return {
      configured: !!bin,
      enabled: this.enabled(),
      autoInstall: this.autoInstall(),
      bin: bin || null,
      binSource: this.binSource,
      version: this.versionCache,
      provider: 'yt-dlp',
      requiresApiKey: false,
      lastError: bin ? null : this.lastError,
      auth: {
        globalCookiesConfigured: !!globalCookies,
        cookiesDir,
        hostCookieFiles,
        bearerConfigured: !!this.globalBearer(),
        extraHeaders: this.globalHeaders().length,
      },
    };
  }

  async probe(url: string, auth?: YtdlpAuthOverride): Promise<YtdlpProbeResult> {
    const pageUrl = await this.requireHttpUrl(url);
    const raw = await this.runJson([
      ...this.authArgs(pageUrl, auth),
      '--dump-single-json',
      '--flat-playlist',
      '--no-download',
      '--no-warnings',
      pageUrl,
    ]);

    const extractor = String(raw.extractor || raw.extractor_key || 'unknown');
    const id = String(raw.id || this.hashRef(pageUrl));
    const title = String(raw.title || raw.playlist_title || `Import ${id}`).trim();
    const coverUrl = this.pickThumb(raw);
    const description = raw.description != null ? String(raw.description).trim() : undefined;
    const webpageUrl = String(raw.webpage_url || raw.original_url || pageUrl);

    const entries = Array.isArray(raw.entries) ? raw.entries.filter(Boolean) : null;
    if (entries && entries.length > 0) {
      const episodes: YtdlpProbeEpisode[] = [];
      for (let i = 0; i < entries.length; i++) {
        const ep = entries[i];
        if (!ep || typeof ep !== 'object') continue;
        const epId = String(ep.id || ep.url || `${id}-${i + 1}`);
        const epUrl = String(ep.webpage_url || ep.url || ep.original_url || '').trim();
        const hasOwnPage = /^https?:\/\//i.test(epUrl);
        episodes.push({
          index: i + 1,
          id: epId,
          title: String(ep.title || `第 ${i + 1} 集`).trim(),
          durationSec: Number(ep.duration) > 0 ? Math.round(Number(ep.duration)) : undefined,
          webpageUrl: hasOwnPage ? epUrl : pageUrl,
          playlistIndex: hasOwnPage ? undefined : i + 1,
          candidateCount: Array.isArray(ep.formats) ? ep.formats.length : 0,
        });
      }
      return {
        extractor,
        id,
        title,
        coverUrl,
        description,
        webpageUrl,
        kind: 'playlist',
        episodes,
      };
    }

    return {
      extractor,
      id,
      title,
      coverUrl,
      description,
      webpageUrl,
      kind: 'single',
      episodes: [
        {
          index: 1,
          id,
          title,
          durationSec: Number(raw.duration) > 0 ? Math.round(Number(raw.duration)) : undefined,
          webpageUrl,
          candidateCount: Array.isArray(raw.formats) ? raw.formats.length : 0,
        },
      ],
    };
  }

  async resolvePlayUrl(
    url: string,
    preference: YtdlpFormatPreference = 'best_hls',
    playlistIndex?: number,
    auth?: YtdlpAuthOverride,
  ): Promise<string> {
    const pageUrl = await this.requireHttpUrl(url);
    const format = this.formatSelector(preference);
    const args = [
      ...this.authArgs(pageUrl, auth),
      '-g',
      '-f',
      format,
      '--no-download',
      '--no-warnings',
    ];
    if (playlistIndex && playlistIndex > 0) {
      args.push('--playlist-items', String(playlistIndex));
    } else {
      args.push('--no-playlist');
    }
    args.push(pageUrl);

    const stdout = await this.runText(args);
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));
    if (!lines.length) {
      throw new BizException(BizCode.BAD_REQUEST, `无法从该链接解析播放地址`);
    }

    const hls = lines.find((l) => /\.m3u8(\?|$)/i.test(l) || /\/hls\//i.test(l));
    if (preference === 'best_hls' && hls) return hls;
    const mp4 = lines.find((l) => /\.mp4(\?|$)/i.test(l));
    if (preference === 'best_mp4' && mp4) return mp4;
    return lines[0];
  }

  /**
   * Download a single video (or playlist item) into outputDir as a local file for ffmpeg.
   * Prefer merged mp4 so the existing upload→HLS pipeline can consume it.
   */
  async downloadToFile(
    url: string,
    outputDir: string,
    preference: YtdlpFormatPreference = 'best',
    playlistIndex?: number,
    auth?: YtdlpAuthOverride,
  ): Promise<{ absPath: string; filename: string; size: number }> {
    const pageUrl = await this.requireHttpUrl(url);
    fs.mkdirSync(outputDir, { recursive: true });
    const stem = `${Date.now()}-${this.hashRef(pageUrl + String(playlistIndex || 0))}`;
    const template = path.join(outputDir, `${stem}.%(ext)s`);
    const format = this.downloadFormatSelector(preference);
    const args = [
      ...this.authArgs(pageUrl, auth),
      '-f',
      format,
      '-o',
      template,
      '--merge-output-format',
      'mp4',
      '--no-warnings',
      '--newline',
      '--print',
      'after_move:filepath',
      '--print',
      'filepath',
    ];
    if (playlistIndex && playlistIndex > 0) {
      args.push('--playlist-items', String(playlistIndex));
    } else {
      args.push('--no-playlist');
    }
    args.push(pageUrl);

    const stdout = await this.runText(args, this.downloadTimeoutMs());
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let absPath =
      [...lines].reverse().find((l) => fs.existsSync(l) && fs.statSync(l).isFile()) || '';
    if (!absPath) {
      // Fallback: look for stem.* in outputDir
      const candidates = fs
        .readdirSync(outputDir)
        .filter((f) => f.startsWith(stem + '.'))
        .map((f) => path.join(outputDir, f));
      absPath =
        candidates.find((p) => VIDEO_EXT.has(path.extname(p).toLowerCase())) || candidates[0] || '';
    }
    if (!absPath || !fs.existsSync(absPath)) {
      throw new BizException(BizCode.BAD_REQUEST, 'yt-dlp 下载完成但未找到输出文件');
    }
    const ext = path.extname(absPath).toLowerCase();
    if (!VIDEO_EXT.has(ext)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `下载格式不受转码支持: ${ext || '(无扩展名)'}`,
      );
    }
    const stat = fs.statSync(absPath);
    return {
      absPath,
      filename: path.basename(absPath),
      size: stat.size,
    };
  }

  externalRefFor(webpageUrl: string, extractor: string, id: string) {
    const safeExt = String(extractor || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 32);
    const safeId = String(id || this.hashRef(webpageUrl))
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 80);
    return `ytdlp:${safeExt}:${safeId}`;
  }

  private cookiesDir() {
    const configured = this.config.get<string>('YTDLP_COOKIES_DIR')?.trim();
    const dir = configured
      ? path.resolve(configured)
      : path.join(this.storageRoot(), 'secrets', 'cookies');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    return dir;
  }

  private globalCookiesFile(): string | null {
    const p = this.config.get<string>('YTDLP_COOKIES_FILE')?.trim();
    if (!p) return null;
    const abs = path.resolve(p);
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
  }

  private globalBearer(): string | null {
    const t = this.config.get<string>('YTDLP_AUTH_BEARER')?.trim();
    return t || null;
  }

  private globalHeaders(): string[] {
    const raw = this.config.get<string>('YTDLP_ADD_HEADERS')?.trim();
    if (!raw) return [];
    return raw
      .split(/\r?\n|\|\|/)
      .map((l) => l.trim())
      .filter((l) => l.includes(':'));
  }

  /** Resolve Netscape cookies file for a page URL (override → host file → global). */
  resolveCookiesFile(pageUrl: string, override?: YtdlpAuthOverride): string | null {
    if (override?.cookiesFile?.trim()) {
      return this.sanitizeCookiesPath(override.cookiesFile.trim());
    }
    try {
      const host = new URL(pageUrl).hostname.toLowerCase();
      const bare = host.replace(/^www\./, '');
      const dir = this.cookiesDir();
      for (const name of [`${host}.txt`, `${bare}.txt`]) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
    } catch {
      /* ignore */
    }
    return this.globalCookiesFile();
  }

  private sanitizeCookiesPath(input: string): string {
    const dir = path.resolve(this.cookiesDir());
    const abs = path.isAbsolute(input)
      ? path.resolve(input)
      : path.resolve(dir, input);
    const rel = path.relative(dir, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `cookies 文件必须位于 ${dir} 目录内`,
      );
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new BizException(BizCode.BAD_REQUEST, `cookies 文件不存在: ${path.basename(abs)}`);
    }
    return abs;
  }

  /** yt-dlp auth flags inserted before the URL argument. */
  authArgs(pageUrl: string, override?: YtdlpAuthOverride): string[] {
    const args: string[] = [];
    const cookies = this.resolveCookiesFile(pageUrl, override);
    if (cookies) {
      args.push('--cookies', cookies);
    }
    const headers = [...this.globalHeaders(), ...(override?.headers || [])];
    const bearer = override?.bearerToken?.trim() || this.globalBearer();
    if (bearer) {
      headers.push(`Authorization: Bearer ${bearer}`);
    }
    const seen = new Set<string>();
    for (const h of headers) {
      const line = String(h || '').trim();
      if (!line.includes(':')) continue;
      const key = line.slice(0, line.indexOf(':')).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      args.push('--add-header', line);
    }
    return args;
  }

  /**
   * Save a Netscape cookies.txt under cookies dir as `{hostname}.txt`.
   * Hostname may be full host or bare domain (www. stripped for filename preference).
   */
  saveHostCookiesFile(opts: {
    hostname: string;
    content: Buffer | string;
  }): { filename: string; absPath: string; bytes: number } {
    const host = String(opts.hostname || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/:\d+$/, '');
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) {
      throw new BizException(BizCode.BAD_REQUEST, '请填写合法域名，如 reelshort.com');
    }
    const bare = host.replace(/^www\./, '');
    const filename = `${bare}.txt`;
    const dir = this.cookiesDir();
    const absPath = path.join(dir, filename);
    const buf = Buffer.isBuffer(opts.content)
      ? opts.content
      : Buffer.from(String(opts.content), 'utf8');
    if (buf.length < 8 || buf.length > 2 * 1024 * 1024) {
      throw new BizException(BizCode.BAD_REQUEST, 'cookies 文件大小无效（8B–2MB）');
    }
    const text = buf.toString('utf8');
    if (!/# Netscape|HTTP Cookie File|\t/i.test(text)) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '请上传 Netscape 格式 cookies.txt（浏览器扩展导出）',
      );
    }
    fs.writeFileSync(absPath, buf);
    return { filename, absPath, bytes: buf.length };
  }

  private formatSelector(preference: YtdlpFormatPreference) {
    if (preference === 'best_mp4') {
      return 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best';
    }
    if (preference === 'best') {
      return 'best/bestvideo+bestaudio';
    }
    return 'best[protocol^=m3u8]/best[ext=m3u8]/best/bestvideo+bestaudio';
  }

  /** Format selector for disk download (merge to a single file ffmpeg can read). */
  private downloadFormatSelector(preference: YtdlpFormatPreference) {
    if (preference === 'best_mp4') {
      return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
    // Compatible with yt-dlp 2023.x (avoid bestvideo* which needs newer builds).
    return 'bestvideo+bestaudio/best';
  }

  private async requireBin() {
    const bin = await this.ensureReady();
    if (!bin) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        this.lastError
          ? `yt-dlp 不可用: ${this.lastError}`
          : '未检测到 yt-dlp。已默认尝试自动下载；也可设置 YTDLP_BIN 或在镜像中预装后重启 API',
      );
    }
    return bin;
  }

  private async requireHttpUrl(url: string) {
    const u = String(url || '').trim();
    if (!u) throw new BizException(BizCode.BAD_REQUEST, '请填写公开视频页链接');
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, '无效链接');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BizException(BizCode.BAD_REQUEST, '仅支持 http/https 公开链接');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
      throw new BizException(BizCode.BAD_REQUEST, '不允许访问本机或内部网络地址');
    }
    let addresses: string[];
    try {
      addresses = isIP(hostname)
        ? [hostname]
        : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, '链接域名无法解析');
    }
    if (!addresses.length || addresses.some((address) => this.isPrivateAddress(address))) {
      throw new BizException(BizCode.BAD_REQUEST, '不允许访问私网、回环或保留地址');
    }
    return u;
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) {
      return this.isPrivateAddress(normalized.slice('::ffff:'.length));
    }
    if (isIP(normalized) === 6) {
      return (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized)
      );
    }
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  private pickThumb(raw: any): string | undefined {
    const t = raw?.thumbnail;
    if (typeof t === 'string' && /^https?:\/\//i.test(t)) return t;
    if (Array.isArray(raw?.thumbnails) && raw.thumbnails.length) {
      const last = raw.thumbnails[raw.thumbnails.length - 1];
      const u = last?.url;
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u;
    }
    return undefined;
  }

  private hashRef(s: string) {
    return createHash('sha1').update(s).digest('hex').slice(0, 16);
  }

  private async runJson(args: string[]): Promise<any> {
    const text = await this.runText(args);
    try {
      return JSON.parse(text);
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, 'yt-dlp 返回非 JSON，无法解析该链接');
    }
  }

  private async runText(args: string[], timeoutMs?: number): Promise<string> {
    const bin = await this.requireBin();
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, {
        timeout: timeoutMs ?? this.timeoutMs(),
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      const out = String(stdout || '').trim();
      if (out) return out;
      const err = String(stderr || '').trim();
      throw new BizException(
        BizCode.BAD_REQUEST,
        `yt-dlp 无输出${err ? `: ${err.slice(0, 200)}` : ''}`,
      );
    } catch (e: any) {
      if (e instanceof BizException) throw e;
      const msg =
        e?.stderr?.toString?.()?.trim() ||
        e?.message ||
        'yt-dlp 执行失败';
      this.logger.warn(`yt-dlp failed: ${String(msg).slice(0, 300)}`);
      throw new BizException(
        BizCode.BAD_REQUEST,
        `yt-dlp 解析失败: ${String(msg).replace(/\s+/g, ' ').slice(0, 220)}`,
      );
    }
  }
}
