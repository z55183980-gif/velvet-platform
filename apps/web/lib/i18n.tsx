"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "./mock-data";

const vi = {
  nav: {
    home: "Trang chủ",
    new: "Phim mới",
    hot: "Hot",
    categories: "Thể loại",
    vip: "VIP",
    balance: "Số dư",
    login: "Đăng nhập",
    account: "Tài khoản",
  },
  langToggle: "VI",
  langSwitchHint: "Chuyển sang 中文",
  hero: {
    overline: "Phim ngắn Việt Nam",
    title: "Câu chuyện ngắn, cảm xúc dài",
    subtitle:
      "Hàng ngàn bộ phim ngắn độc quyền. Xem mọi lúc, mọi nơi — chỉ với một cú chạm.",
    ctaPrimary: "Xem ngay",
    ctaSecondary: "Xem miễn phí",
  },
  sections: {
    trending: "Đang thịnh hành",
    newReleases: "Phim mới",
    forYou: "Dành cho bạn",
    allCategories: "Tất cả thể loại",
  },
  card: {
    unlock: "Mở khóa",
    free: "Miễn phí",
    unlocked: "Đã mở khóa",
    episodes: "tập",
    vip: "VIP",
    credits: "credits",
  },
  detail: {
    watchFree: "Xem tập miễn phí",
    unlockEpisode: "Mở khóa tập này",
    about: "Giới thiệu",
    episodeList: "Danh sách tập",
    rating: "Đánh giá",
    year: "Năm",
    category: "Thể loại",
  },
  unlock: {
    title: "Mở khóa tập",
    episodeNumber: "Mở khóa tập {n}",
    priceLabel: "Credits cần mở khóa",
    balanceLabel: "Số dư hiện tại",
    confirm: "Xác nhận mở khóa",
    cancel: "Hủy",
    processing: "Đang xử lý...",
    success: "Đã mở khóa!",
    error: "Mở khóa thất bại",
    retry: "Thử lại",
    insufficient: "Không đủ credits, vui lòng nạp thêm",
    goRecharge: "Nạp credits",
  },
  recharge: {
    title: "Nạp credits",
    subtitle: "Chọn gói credits; tiền tệ khác quy đổi theo tỷ giá CNY",
    currency: "Loại tiền",
    package: "Gói",
    amount: "Số tiền",
    getCredits: "Nhận được",
    payAmount: "Thanh toán",
    confirm: "Nạp ngay",
    success: "Nạp thành công!",
    method: "Phương thức",
    alipay: "Alipay",
    simulate: "Mô phỏng (dev)",
    redirecting: "Đang chuyển tới Alipay...",
    alipayCnyOnly: "Alipay chỉ hỗ trợ CNY",
    emptyPackages: "Chưa có gói nạp",
  },
  login: {
    title: "Đăng nhập",
    subtitle: "Tài khoản hoặc email + mật khẩu",
    tabLogin: "Đăng nhập",
    tabRegister: "Đăng ký",
    tabEmail: "Email",
    tabPhone: "SĐT",
    methodOtp: "Mã OTP",
    methodPassword: "Mật khẩu",
    usePhoneDev: "Dùng SĐT (chỉ dev)",
    useEmail: "Dùng email",
    phoneDevHint: "OTP SĐT chỉ dành cho môi trường phát triển",
    accountPlaceholder: "Tài khoản hoặc email",
    emailPlaceholder: "Email",
    usernamePlaceholder: "Tài khoản (3–24 chữ/số/_)",
    sendOtp: "Gửi mã OTP",
    sendResetCode: "Gửi mã đặt lại",
    sending: "Đang gửi...",
    verifying: "Đang xử lý...",
    confirm: "Đăng nhập",
    changeIdentity: "Quay lại",
    sendFail: "Gửi mã thất bại",
    verifyFail: "Sai thông tin",
    passwordPlaceholder: "Mật khẩu",
    setPasswordPlaceholder: "Mật khẩu (≥6 ký tự)",
    newPasswordPlaceholder: "Mật khẩu mới (≥6 ký tự)",
    resetCodePlaceholder: "Mã đặt lại",
    resetCodeHint: "Nhập mã đã gửi tới email, rồi đặt mật khẩu mới",
    smtpNotConfigured: "(SMTP chưa cấu hình)",
    nicknamePlaceholder: "Biệt danh (tuỳ chọn)",
    forgotLink: "Quên mật khẩu?",
    backToLogin: "Quay lại đăng nhập",
    registerTitle: "Đăng ký",
    registerSubtitle: "Điền email, tài khoản và mật khẩu",
    registerConfirm: "Đăng ký",
    forgotTitle: "Đặt lại mật khẩu",
    forgotSubtitle: "Nhập email đã đăng ký để nhận mã",
    resetConfirm: "Đặt lại mật khẩu",
  },
  account: {
    title: "Tài khoản",
    subtitle: "Thông tin cá nhân, ví và lịch sử",
    nickname: "Biệt danh",
    email: "Email",
    phone: "SĐT",
    balance: "Số dư",
    recharge: "Nạp tiền",
    logout: "Đăng xuất",
    save: "Lưu",
    saved: "Đã lưu",
    favorites: "Yêu thích",
    history: "Đã xem",
    transactions: "Giao dịch ví",
    orders: "Đơn hàng",
    emptyFav: "Chưa có phim yêu thích",
    emptyHistory: "Chưa có lịch sử xem",
    emptyTx: "Chưa có giao dịch",
    clearHistory: "Xóa lịch sử",
    loginHint: "Đăng nhập để xem tài khoản",
    episode: "Tập",
  },
  player: {
    loading: "Đang tải...",
    error: "Không thể phát video",
    empty: "Chưa có tập được chọn",
  },
  footer: {
    tagline: "Nền tảng phim ngắn hàng đầu Việt Nam",
    rights: "© 2026 DramaVN. Bản quyền thuộc về DramaVN.",
  },
  ds: {
    title: "Hệ thống thiết kế DramaVN",
    subtitle: "Dark cinematic · không gian thở · typography quốc tế",
    colors: "Màu sắc",
    typeScale: "Cỡ chữ",
    spacing: "Khoảng cách",
    components: "Thành phần",
    states: "Trạng thái",
    notes: "Ghi chú",
  },
  common: { close: "Đóng" },
  admin: {
    dashboard: "Tổng quan",
    content: "Nội dung",
    banners: "Banner",
    categories: "Thể loại",
    users: "Người dùng",
    orders: "Đơn hàng",
    withdraws: "Rút tiền",
    kyc: "KYC",
    wallet: "Ví / Ledger",
    rates: "Tỷ giá CNY",
    packages: "Gói credits",
    reconcile: "Đối soát",
    audit: "Audit",
    creators: "Creator",
    settings: "Cài đặt",
    todos: "Việc cần xử lý",
    pendingDramas: "Phim chờ duyệt",
    pendingWithdraws: "Rút tiền",
    overdue: ">24h",
    refresh: "Tải lại",
    loading: "Đang tải…",
    backSite: "Về site",
    logout: "Đăng xuất",
    exportCsv: "Xuất CSV",
    refunds: "Hoàn tiền",
    slaWarn: "Quá 24h",
    search: "Tìm",
    filter: "Lọc",
    status: "Trạng thái",
    all: "Tất cả",
    pending: "Chờ duyệt",
    approve: "Duyệt",
    reject: "Từ chối",
    save: "Lưu",
    create: "Tạo",
    update: "Cập nhật",
    cancel: "Huỷ",
    delete: "Xoá",
    edit: "Sửa",
    empty: "Chưa có dữ liệu",
    actions: "Thao tác",
    time: "Thời gian",
  },
};

const zh: typeof vi = {
  nav: {
    home: "首页",
    new: "最新",
    hot: "热门",
    categories: "分类",
    vip: "VIP",
    balance: "余额",
    login: "登录",
    account: "账户",
  },
  langToggle: "中文",
  langSwitchHint: "切换到 VI",
  hero: {
    overline: "越南短剧",
    title: "短故事，长情绪",
    subtitle: "数千部独家短剧，随时随地，一触即看。",
    ctaPrimary: "立即观看",
    ctaSecondary: "免费试看",
  },
  sections: {
    trending: "正在热播",
    newReleases: "最新上架",
    forYou: "为你推荐",
    allCategories: "全部分类",
  },
  card: {
    unlock: "解锁",
    free: "免费",
    unlocked: "已解锁",
    episodes: "集",
    vip: "VIP",
    credits: "积分",
  },
  detail: {
    watchFree: "观看免费集",
    unlockEpisode: "解锁本集",
    about: "简介",
    episodeList: "选集",
    rating: "评分",
    year: "年份",
    category: "分类",
  },
  unlock: {
    title: "解锁本集",
    episodeNumber: "解锁第 {n} 集",
    priceLabel: "所需积分",
    balanceLabel: "当前余额",
    confirm: "确认解锁",
    cancel: "取消",
    processing: "处理中...",
    success: "已解锁！",
    error: "解锁失败",
    retry: "重试",
    insufficient: "积分不足，请先充值",
    goRecharge: "去充值",
  },
  recharge: {
    title: "充值积分",
    subtitle: "选择积分套餐；其它法币按后台人民币汇率折算",
    currency: "支付币种",
    package: "套餐",
    amount: "金额",
    getCredits: "到账积分",
    payAmount: "应付",
    confirm: "立即充值",
    success: "充值成功！",
    method: "支付方式",
    alipay: "支付宝",
    simulate: "模拟支付 (开发)",
    redirecting: "正在跳转支付宝…",
    alipayCnyOnly: "支付宝仅支持人民币",
    emptyPackages: "暂无充值套餐",
  },
  login: {
    title: "登录",
    subtitle: "账号或邮箱 + 密码",
    tabLogin: "登录",
    tabRegister: "注册",
    tabEmail: "邮箱",
    tabPhone: "手机",
    methodOtp: "验证码",
    methodPassword: "密码",
    usePhoneDev: "改用手机号（仅开发）",
    useEmail: "改用邮箱",
    phoneDevHint: "手机验证码仅开发环境可用",
    accountPlaceholder: "账号或邮箱",
    emailPlaceholder: "邮箱",
    usernamePlaceholder: "账号（3–24 位字母数字下划线）",
    sendOtp: "发送验证码",
    sendResetCode: "发送重置识别码",
    sending: "发送中…",
    verifying: "处理中…",
    confirm: "登录",
    changeIdentity: "返回上一步",
    sendFail: "发送失败",
    verifyFail: "账号或密码错误",
    passwordPlaceholder: "密码",
    setPasswordPlaceholder: "密码（至少 6 位）",
    newPasswordPlaceholder: "新密码（至少 6 位）",
    resetCodePlaceholder: "重置识别码",
    resetCodeHint: "填写邮箱收到的识别码，再设新密码",
    smtpNotConfigured: "（邮件未配置，识别码见上方）",
    nicknamePlaceholder: "昵称（可选）",
    forgotLink: "忘记密码？",
    backToLogin: "返回登录",
    registerTitle: "注册",
    registerSubtitle: "填写邮箱、账号和密码即可",
    registerConfirm: "注册",
    forgotTitle: "找回密码",
    forgotSubtitle: "输入注册时的邮箱，获取重置识别码",
    resetConfirm: "重置密码",
  },
  account: {
    title: "个人中心",
    subtitle: "账户信息、余额、收藏与观看历史",
    nickname: "昵称",
    email: "邮箱",
    phone: "手机",
    balance: "余额",
    recharge: "充值",
    logout: "退出登录",
    save: "保存",
    saved: "已保存",
    favorites: "我的收藏",
    history: "观看历史",
    transactions: "充值 / 消费记录",
    orders: "订单",
    emptyFav: "还没有收藏",
    emptyHistory: "还没有观看记录",
    emptyTx: "还没有交易记录",
    clearHistory: "清空历史",
    loginHint: "登录后查看个人中心",
    episode: "第",
  },
  player: {
    loading: "加载中...",
    error: "无法播放视频",
    empty: "尚未选择剧集",
  },
  footer: {
    tagline: "越南领先的短剧平台",
    rights: "© 2026 DramaVN. 版权所有。",
  },
  ds: {
    title: "DramaVN 设计系统",
    subtitle: "深色电影感 · 呼吸感间距 · 国际化排版",
    colors: "色彩",
    typeScale: "字号阶梯",
    spacing: "间距",
    components: "组件",
    states: "状态",
    notes: "说明",
  },
  common: { close: "关闭" },
  admin: {
    dashboard: "仪表盘",
    content: "内容库",
    banners: "Banner",
    categories: "分类",
    users: "用户 CRM",
    orders: "订单 / 退款",
    withdraws: "提现",
    kyc: "KYC",
    wallet: "钱包流水",
    rates: "法币汇率",
    packages: "积分套餐",
    reconcile: "对账",
    audit: "审计日志",
    creators: "创作者收益",
    settings: "系统设置",
    todos: "待办",
    pendingDramas: "待审短剧",
    pendingWithdraws: "提现",
    overdue: ">24h",
    refresh: "刷新",
    loading: "加载中…",
    backSite: "回前台",
    logout: "退出",
    exportCsv: "导出 CSV",
    refunds: "退款",
    slaWarn: "超 24h",
    search: "搜索",
    filter: "筛选",
    status: "状态",
    all: "全部",
    pending: "待审",
    approve: "通过",
    reject: "拒绝",
    save: "保存",
    create: "创建",
    update: "更新",
    cancel: "取消",
    delete: "删除",
    edit: "编辑",
    empty: "暂无数据",
    actions: "操作",
    time: "时间",
  },
};

const dicts: Record<Locale, typeof vi> = { vi, zh };

function lookup(obj: unknown, path: string): string {
  const val = path.split(".").reduce<unknown>((o, k) => {
    if (o && typeof o === "object" && k in (o as Record<string, unknown>)) {
      return (o as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
  return typeof val === "string" ? val : path;
}

function cookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )dv_locale=(zh|vi)(?:;|$)/);
  return m ? (m[1] as Locale) : null;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("vi");

  useEffect(() => {
    const fromCookie = cookieLocale();
    const saved = localStorage.getItem("locale") as Locale | null;
    const next: Locale =
      fromCookie === "zh" || fromCookie === "vi"
        ? fromCookie
        : saved === "zh" || saved === "vi"
          ? saved
          : "vi";
    setLocaleState(next);
    localStorage.setItem("locale", next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "vi" ? "vi" : "zh";
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("locale", l);
    document.cookie = `dv_locale=${l}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      let s = lookup(dicts[locale], path);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
