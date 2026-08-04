export type { Locale } from "./languages";
import type { Locale } from "./languages";

export interface Category {
  slug: string;
  nameVi: string;
  nameZh: string;
}

export interface Episode {
  id?: string | number;
  no: number;
  titleVi: string;
  titleZh: string;
  isFree: boolean;
  price: number;
  unlocked?: boolean;
}

export interface Drama {
  id: string;
  /** 数据库数字 ID，收藏等接口用 */
  numericId?: string;
  titleVi: string;
  titleZh: string;
  descVi: string;
  descZh: string;
  categorySlug: string;
  /** Theme/genre tags (Hongguo-style chips under title) */
  tags?: string[];
  cover: [string, string];
  isVip: boolean;
  rating: number;
  year: number;
  episodesCount: number;
  freeCount: number;
  pricePerEp: number;
  /** 整剧买断积分价；null/undefined = 不支持 */
  buyoutCredits?: string | null;
  /** 真实收藏数（来自 API favoriteCount） */
  favoriteCount?: number;
  /** 真实点赞数（来自 API likeCount） */
  likeCount?: number;
  creator?: { displayName: string; avatarUrl?: string | null };
  episodes: Episode[];
}

export const categories: Category[] = [
  { slug: "do_thi", nameVi: "Đô thị", nameZh: "都市" },
  { slug: "ngon_tinh", nameVi: "Ngôn tình", nameZh: "言情" },
  { slug: "hanh_dong", nameVi: "Hành động", nameZh: "动作" },
  { slug: "hai_huoc", nameVi: "Hài hước", nameZh: "喜剧" },
  { slug: "tam_ly", nameVi: "Tâm lý", nameZh: "心理" },
  { slug: "co_trang", nameVi: "Cổ trang", nameZh: "古装" },
];

function makeEpisodes(count: number, freeCount: number, price: number): Episode[] {
  return Array.from({ length: count }, (_, i) => {
    const no = i + 1;
    return {
      id: `ep-${no}`,
      no,
      titleVi: `Tập ${no}:${no <= 3 ? " Mở đầu" : no % 5 === 0 ? " Cao trào" : " Diễn biến"}`,
      titleZh: `第 ${no} 集：${no <= 3 ? "开端" : no % 5 === 0 ? "高潮" : "剧情"}`,
      isFree: no <= freeCount,
      price,
    };
  });
}

export const dramas: Drama[] = [
  {
    id: "d01",
    titleVi: "Tổng tài lạnh lùng đột nhiên theo đuổi tôi",
    titleZh: "冷面霸总突然追我",
    descVi: "Cô ấy chỉ là một thư ký bình thường, cho đến khi ông chủ tối cao đột nhiên thay đổi thái độ.",
    descZh: "她只是个普通秘书，直到那位至高无上的老板突然改变了态度。",
    categorySlug: "ngon_tinh",
    cover: ["#FF6A88", "#FF99AC"],
    isVip: false,
    rating: 4.9,
    year: 2026,
    episodesCount: 60,
    freeCount: 3,
    pricePerEp: 15000,
    episodes: makeEpisodes(60, 3, 15000),
  },
  {
    id: "d02",
    titleVi: "Vợ cũ trở về sau 5 năm",
    titleZh: "五年后前妻归来",
    descVi: "Anh ấy đã quên cô ấy, nhưng số phận một lần nữa kéo hai người lại gần nhau.",
    descZh: "他已忘了她，但命运再次将两人拉近。",
    categorySlug: "ngon_tinh",
    cover: ["#6A5ACD", "#9D8DF1"],
    isVip: true,
    rating: 4.8,
    year: 2026,
    episodesCount: 48,
    freeCount: 2,
    pricePerEp: 20000,
    episodes: makeEpisodes(48, 2, 20000),
  },
  {
    id: "d03",
    titleVi: "Cảnh sát đặc nhiệm và nữ luật sư",
    titleZh: "特警与女律师",
    descVi: "Một vụ án mạng kéo hai thế giới song song lại với nhau.",
    descZh: "一桩命案将两个平行世界拉到一起。",
    categorySlug: "tam_ly",
    cover: ["#1F2937", "#374151"],
    isVip: false,
    rating: 4.7,
    year: 2025,
    episodesCount: 36,
    freeCount: 3,
    pricePerEp: 12000,
    episodes: makeEpisodes(36, 3, 12000),
  },
  {
    id: "d04",
    titleVi: "Thị trưởng và cô gái bán hoa",
    titleZh: "市长与卖花女孩",
    descVi: "Một tình yêu vượt qua tầng lớp xã hội giữa ánh đèn thành phố.",
    descZh: "城市灯火下，一段跨越阶层的爱情。",
    categorySlug: "do_thi",
    cover: ["#F59E0B", "#FBBF24"],
    isVip: false,
    rating: 4.6,
    year: 2026,
    episodesCount: 40,
    freeCount: 3,
    pricePerEp: 10000,
    episodes: makeEpisodes(40, 3, 10000),
  },
  {
    id: "d05",
    titleVi: "Ông trùm giả danh nhân viên văn phòng",
    titleZh: "大佬伪装成办公室职员",
    descVi: "Không ai ngờ người đàn ông trầm tính ấy lại là ông chủ của cả tập đoàn.",
    descZh: "没人想到那个沉静的男人竟是整座集团的主人。",
    categorySlug: "ngon_tinh",
    cover: ["#0EA5E9", "#38BDF8"],
    isVip: true,
    rating: 4.9,
    year: 2026,
    episodesCount: 55,
    freeCount: 2,
    pricePerEp: 18000,
    episodes: makeEpisodes(55, 2, 18000),
  },
  {
    id: "d06",
    titleVi: "Mẹ đơn thân thế kỷ mới",
    titleZh: "新时代单亲妈妈",
    descVi: "Cô ấy nuôi con một mình, nhưng chưa bao giờ đầu hàng số phận.",
    descZh: "她独自抚育孩子，却从未向命运低头。",
    categorySlug: "hai_huoc",
    cover: ["#EC4899", "#F472B6"],
    isVip: false,
    rating: 4.5,
    year: 2025,
    episodesCount: 32,
    freeCount: 4,
    pricePerEp: 9000,
    episodes: makeEpisodes(32, 4, 9000),
  },
  {
    id: "d07",
    titleVi: "Đặc vụ ngầm: Phi vụ cuối cùng",
    titleZh: "卧底特工：最后一单",
    descVi: "Anh ta thâm nhập tổ chức tội phạm, nhưng tình cảm khiến一切 thay đổi.",
    descZh: "他潜入犯罪组织，却因情感让一切改变。",
    categorySlug: "hanh_dong",
    cover: ["#7F1D1D", "#B91C1C"],
    isVip: false,
    rating: 4.8,
    year: 2026,
    episodesCount: 44,
    freeCount: 3,
    pricePerEp: 13000,
    episodes: makeEpisodes(44, 3, 13000),
  },
  {
    id: "d08",
    titleVi: "Cô dâu thay thế của gia tộc họ Mặc",
    titleZh: "墨家替嫁新娘",
    descVi: "Một đêm trước hôn lễ, cô dâu thật biến mất, kẻ thay thế bước vào đại môn.",
    descZh: "婚礼前一晚，真新娘消失，替身踏入豪门。",
    categorySlug: "ngon_tinh",
    cover: ["#8B5CF6", "#A78BFA"],
    isVip: true,
    rating: 4.7,
    year: 2026,
    episodesCount: 50,
    freeCount: 2,
    pricePerEp: 16000,
    episodes: makeEpisodes(50, 2, 16000),
  },
  {
    id: "d09",
    titleVi: "Bác sĩ thiên tài và nữ CEO",
    titleZh: "天才医生与女总裁",
    descVi: "Trong phòng mổ, anh là vị cứu tinh; ngoài đời, cô là người cầm quyền.",
    descZh: "手术台上他是救星，生活里她掌握权柄。",
    categorySlug: "do_thi",
    cover: ["#10B981", "#34D399"],
    isVip: false,
    rating: 4.6,
    year: 2025,
    episodesCount: 38,
    freeCount: 3,
    pricePerEp: 11000,
    episodes: makeEpisodes(38, 3, 11000),
  },
];

export function getDrama(id: string): Drama | undefined {
  return dramas.find((d) => d.id === id);
}

export function categoryName(slug: string, locale: Locale): string {
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return slug;
  return locale === "vi" ? cat.nameVi : cat.nameZh;
}

// ---- 兜底数据（API 不可达时使用，保持预览可见）----
export const featuredDramas: Drama[] = dramas.slice(0, 5);

export function mockHome(
  page = 1,
  pageSize = 12,
  opts?: { category?: string; q?: string; sort?: "latest" | "hot" },
): { rows: Drama[]; total: number } {
  let list = dramas;
  if (opts?.category) list = list.filter((d) => d.categorySlug === opts.category);
  if (opts?.q) {
    const q = opts.q.toLowerCase();
    list = list.filter(
      (d) =>
        d.titleVi.toLowerCase().includes(q) ||
        d.titleZh.toLowerCase().includes(q) ||
        d.descVi.toLowerCase().includes(q),
    );
  }
  if (opts?.sort === "latest") {
    list = [...list].sort((a, b) => Number(b.id) - Number(a.id));
  } else if (opts?.sort === "hot") {
    list = [...list].sort((a, b) => b.rating - a.rating || b.episodesCount - a.episodesCount);
  }
  const total = list.length;
  const start = (page - 1) * pageSize;
  return { rows: list.slice(start, start + pageSize), total };
}

export function mockDramaDetail(slug: string): { drama: Drama; episodes: Episode[] } | null {
  const drama = dramas.find((d) => d.id === slug);
  if (!drama) return null;
  return { drama, episodes: drama.episodes };
}
