import * as fs from 'fs';
import * as path from 'path';

/** Containers accepted for local upload / folder import (ffmpeg may transcode after ingest). */
export const VIDEO_EXT = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.m4v',
  '.avi',
  '.3gp',
  '.3g2',
  '.wmv',
  '.flv',
  '.f4v',
  '.ts',
  '.m2ts',
  '.mts',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.asf',
]);

export const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.f4v': 'video/x-f4v',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.asf': 'video/x-ms-asf',
};

export const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export function normName(s: string) {
  return s.replace(
    /[\s;:；：，,、.。！!?？'""''()（）\[\]【】`~@#$%^&*\-_=+]/g,
    '',
  );
}

/** 导入/种子默认：付费集统一积分（对齐入门充值套餐，便于测试） */
export const DEFAULT_PAID_CREDITS = 10n;
export const DEFAULT_PAID_VND = 10000n;

export interface DramaImportDef {
  slug: string;
  titleEn: string;
  titleZh: string;
  descEn: string;
  descZh: string;
  category: string;
  freeCount: number;
  /** 付费集积分定价（解锁扣款） */
  priceCredits: bigint;
  /** 法币参考价（分润/展示回退） */
  priceVnd: bigint;
  isOfficial?: boolean;
  isFeatured?: boolean;
}

/** 按「归一化文件夹名」匹配的内置元数据（与 prisma/import-samples.ts 对齐） */
export const BUILTIN_DEFS: Record<string, DramaImportDef> = {
  末世之约: {
    slug: 'mo-shi-zhi-yue',
    titleEn: 'Apocalypse Pact',
    titleZh: '末世之约',
    descEn: 'The world collapses; survivors search for one last hope among the ruins.',
    descZh: '末世降临，幸存者在废墟中追寻最后的希望。',
    category: 'psychological',
    freeCount: 2,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
    isOfficial: true,
    isFeatured: true,
  },
  穿越修仙界我靠手机忽悠全宗门: {
    slug: 'chuan-yue-xiu-xian',
    titleEn: 'Phone Cultivator',
    titleZh: '穿越修仙界，我靠手机忽悠全宗门',
    descEn: 'A modern man travels into a cultivation world with nothing but his phone.',
    descZh: '现代青年带着手机穿越修仙界，凭科技忽悠整个宗门。',
    category: 'costume',
    freeCount: 2,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
    isFeatured: true,
  },
  青灯引僵成片: {
    slug: 'qing-deng-yin-jiang',
    titleEn: 'Blue Lantern Summons the Undead',
    titleZh: '青灯引僵',
    descEn: 'A blue lantern guides the sleeping undead back to the living world.',
    descZh: '一盏青灯，引动沉睡的僵尸归来。',
    category: 'costume',
    freeCount: 1,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
  },
  魔兽争霸霜狼之子荣耀觉醒: {
    slug: 'mo-shou-shuang-lang',
    titleEn: "Warcraft: Frostwolf's Child",
    titleZh: '魔兽争霸：霜狼之子',
    descEn: 'The frost-wolf legend rises again across the battlefields.',
    descZh: '霜狼之子在战场中觉醒，书写魔兽传奇。',
    category: 'action',
    freeCount: 1,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
  },
  星际赘婿地球男儿太抢手: {
    slug: 'xing-ji-zhui-xu',
    titleEn: 'Interstellar Son-in-Law',
    titleZh: '星际赘婿：地球男儿太抢手',
    descEn: 'An earthborn son-in-law shakes the entire galaxy.',
    descZh: '来自地球的赘婿，意外成为星际焦点。',
    category: 'action',
    freeCount: 1,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
  },
  江西赶尸人: {
    slug: 'jiang-xi-gan-shi',
    titleEn: 'Jiangxi Corpse Herder',
    titleZh: '江西赶尸人',
    descEn: 'A corpse herder from Jiangxi walks through dark mountain villages at night.',
    descZh: '江西赶尸人，夜行于幽暗山村之间。',
    category: 'costume',
    freeCount: 2,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
  },
};

export const IMPORT_CATEGORIES = [
  { slug: 'urban', nameEn: 'Urban', nameZh: '都市', nameFr: 'Urbain' },
  { slug: 'romance', nameEn: 'Romance', nameZh: '言情', nameFr: 'Romance' },
  { slug: 'action', nameEn: 'Action', nameZh: '动作', nameFr: 'Action' },
  { slug: 'comedy', nameEn: 'Comedy', nameZh: '喜剧', nameFr: 'Comédie' },
  { slug: 'psychological', nameEn: 'Psychological', nameZh: '心理', nameFr: 'Psychologique' },
  { slug: 'costume', nameEn: 'Costume', nameZh: '古装', nameFr: 'Costume' },
];

export function numCmp(a: string, b: string) {
  const na = parseInt((a.match(/\d+/g) || ['0']).join(''), 10) || 0;
  const nb = parseInt((b.match(/\d+/g) || ['0']).join(''), 10) || 0;
  return na - nb;
}

/** 文件夹名 → slug（未知剧用） */
export function slugifyFolder(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  return base || `drama-${Date.now().toString(36)}`;
}

export function resolveDramaDef(folderName: string): DramaImportDef {
  const builtin = BUILTIN_DEFS[normName(folderName)];
  if (builtin) return builtin;
  return {
    slug: slugifyFolder(folderName),
    titleEn: folderName,
    titleZh: folderName,
    descEn: '',
    descZh: '',
    category: 'urban',
    freeCount: 1,
    priceCredits: DEFAULT_PAID_CREDITS,
    priceVnd: DEFAULT_PAID_VND,
  };
}

export function listVideoFiles(folderAbs: string): string[] {
  const files = fs.readdirSync(folderAbs);
  return files
    .filter((f) => {
      const full = path.join(folderAbs, f);
      try {
        return fs.statSync(full).isFile() && VIDEO_EXT.has(path.extname(f).toLowerCase());
      } catch {
        return false;
      }
    })
    .sort(numCmp);
}

export function pickCoverFile(folderAbs: string): string | null {
  const files = fs.readdirSync(folderAbs);
  const topImgs = files.filter((f) => {
    try {
      return (
        fs.statSync(path.join(folderAbs, f)).isFile() &&
        IMG_EXT.has(path.extname(f).toLowerCase())
      );
    } catch {
      return false;
    }
  });
  return topImgs.find((f) => /cover|封面/i.test(f)) || topImgs[0] || null;
}

export function listDramaDirs(rootPath: string): string[] {
  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}
