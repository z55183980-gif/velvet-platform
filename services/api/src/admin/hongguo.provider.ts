import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BizCode, BizException } from '../common/biz.exception';

export type HongguoSearchItem = {
  id: string;
  title: string;
  coverUrl?: string;
  episodeCount?: number;
  intro?: string;
};

export type HongguoEpisodeItem = {
  videoId: string;
  episodeNumber: number;
  title?: string;
};

export type HongguoDetail = {
  id: string;
  title: string;
  coverUrl?: string;
  intro?: string;
  episodeCount?: number;
  episodes: HongguoEpisodeItem[];
};

/**
 * 红果短剧第三方解析 Provider（52api 风格：search / detail / video）。
 * 配置：HONGGUO_API_BASE、HONGGUO_API_KEY
 */
@Injectable()
export class HongguoProvider {
  private readonly logger = new Logger(HongguoProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('HONGGUO_API_BASE') || 'https://www.52api.cn/api/hg_duanju'
    ).replace(/\/+$/, '');
    this.apiKey = String(config.get<string>('HONGGUO_API_KEY') || '').trim();
  }

  isConfigured() {
    return !!this.apiKey;
  }

  status() {
    return {
      configured: this.isConfigured(),
      baseUrl: this.baseUrl,
      provider: 'hongguo-api',
    };
  }

  async search(keyword: string, page = 1): Promise<HongguoSearchItem[]> {
    this.requireKey();
    const q = String(keyword || '').trim();
    if (!q) throw new BizException(BizCode.BAD_REQUEST, '请输入搜索关键词');
    const data = await this.request({
      type: 'search',
      keyword: q,
      page: String(Math.max(1, page)),
    });
    const list = this.asArray(data);
    return list
      .map((row) => this.mapSearchItem(row))
      .filter((x): x is HongguoSearchItem => !!x);
  }

  async detail(id: string): Promise<HongguoDetail> {
    this.requireKey();
    const bookId = String(id || '').trim();
    if (!bookId) throw new BizException(BizCode.BAD_REQUEST, '缺少剧集 ID');
    const data = await this.request({ type: 'detail', id: bookId });
    const root = this.unwrap(data);
    const title =
      this.pickString(root, ['title', 'name', 'book_name', 'bookName']) || `红果剧集 ${bookId}`;
    const coverUrl = this.pickString(root, [
      'cover',
      'coverUrl',
      'cover_url',
      'pic',
      'poster',
    ]);
    const intro = this.pickString(root, ['intro', 'desc', 'description', 'summary']);
    const episodesRaw = this.asArray(
      root.episodes || root.episode_list || root.list || root.videos || root.data,
    );
    const episodes: HongguoEpisodeItem[] = [];
    for (let i = 0; i < episodesRaw.length; i++) {
      const ep = episodesRaw[i];
      if (!ep || typeof ep !== 'object') continue;
      const videoId = this.pickString(ep, [
        'video_id',
        'videoId',
        'vid',
        'id',
        'episode_id',
      ]);
      if (!videoId) continue;
      const episodeNumber =
        Number(ep.episode_number ?? ep.episodeNumber ?? ep.index ?? ep.sort ?? i + 1) || i + 1;
      episodes.push({
        videoId,
        episodeNumber,
        title: this.pickString(ep, ['title', 'name', 'episode_title']) || undefined,
      });
    }
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    return {
      id: bookId,
      title,
      coverUrl,
      intro,
      episodeCount: episodes.length || Number(root.total || root.episode_count) || undefined,
      episodes,
    };
  }

  async resolvePlayUrl(videoId: string): Promise<string> {
    this.requireKey();
    const id = String(videoId || '').trim();
    if (!id) throw new BizException(BizCode.BAD_REQUEST, '缺少分集 ID');
    const data = await this.request({ type: 'video', video_id: id });
    const root = this.unwrap(data);
    const playUrl = this.pickString(root, [
      'video_url',
      'videoUrl',
      'url',
      'play_url',
      'playUrl',
      'm3u8',
      'hls',
      'src',
    ]);
    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      throw new BizException(BizCode.BAD_REQUEST, `无法解析分集播放地址: ${id}`);
    }
    return playUrl;
  }

  private requireKey() {
    if (!this.apiKey) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        '未配置 HONGGUO_API_KEY，请在 API 环境变量中填写后再使用红果导入',
      );
    }
  }

  private async request(params: Record<string, string>) {
    const url = new URL(this.baseUrl);
    url.searchParams.set('key', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e: any) {
      this.logger.warn(`hongguo request failed: ${e?.message || e}`);
      throw new BizException(BizCode.BAD_REQUEST, `红果接口请求失败: ${e?.message || 'network'}`);
    }
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new BizException(BizCode.BAD_REQUEST, `红果接口返回非 JSON（HTTP ${res.status}）`);
    }
    if (!res.ok) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `红果接口 HTTP ${res.status}: ${json?.msg || json?.message || text.slice(0, 120)}`,
      );
    }
    // 常见包一层 code/msg
    const code = json?.code ?? json?.status ?? json?.errcode;
    if (code != null && String(code) !== '0' && String(code) !== '200' && code !== true) {
      throw new BizException(
        BizCode.BAD_REQUEST,
        `红果接口错误: ${json?.msg || json?.message || JSON.stringify(json).slice(0, 160)}`,
      );
    }
    return json?.data ?? json?.result ?? json;
  }

  private unwrap(data: any): Record<string, any> {
    if (!data) return {};
    if (Array.isArray(data)) return data[0] && typeof data[0] === 'object' ? data[0] : {};
    if (typeof data === 'object') {
      if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
      return data;
    }
    return {};
  }

  private asArray(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  private pickString(obj: Record<string, any>, keys: string[]): string | undefined {
    for (const k of keys) {
      const v = obj?.[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  }

  private mapSearchItem(row: any): HongguoSearchItem | null {
    if (!row || typeof row !== 'object') return null;
    const id = this.pickString(row, ['id', 'book_id', 'bookId', 'drama_id', 'shortplay_id']);
    if (!id) return null;
    const title =
      this.pickString(row, ['title', 'name', 'book_name', 'bookName']) || `红果剧集 ${id}`;
    return {
      id,
      title,
      coverUrl: this.pickString(row, ['cover', 'coverUrl', 'cover_url', 'pic', 'poster']),
      episodeCount: Number(row.total || row.episode_count || row.episodeCount) || undefined,
      intro: this.pickString(row, ['intro', 'desc', 'description']),
    };
  }
}
