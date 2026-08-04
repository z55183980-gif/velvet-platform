"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AdminLocale = "zh" | "en";

export const ADMIN_LOCALES: AdminLocale[] = ["zh", "en"];
export const LOCALE_STORAGE_KEY = "velvet-admin-locale";
export const DEFAULT_LOCALE: AdminLocale = "zh";

const zh = {
  // nav items
  dashboard: "数据概览",
  analytics: "经营报表",
  content: "剧集管理",
  contentPending: "内容审核",
  contentImport: "批量导入",
  categories: "分类管理",
  banners: "首页轮播",
  featured: "推荐位",
  hottest: "最热剧集管理",
  messages: "消息推送",
  users: "用户列表",
  userOverview: "用户概览",
  usersBanned: "封禁风控",
  orders: "订单中心",
  refunds: "退款审核",
  packages: "充值套餐",
  vipPlans: "VIP会员",
  redeemCodes: "兑换码",
  creators: "创作者管理",
  kyc: "KYC审核",
  withdraws: "提现审核",
  wallet: "资金流水",
  reconcile: "对账结算",
  settle: "T+7结算",
  rates: "汇率配置",
  admins: "管理员",
  audit: "操作日志",
  settings: "系统配置",

  // nav groups
  navWorkspace: "工作台",
  navContent: "内容",
  navOps: "运营",
  navUsers: "用户",
  navTrade: "交易",
  navCreators: "创作者",
  navFinance: "财务",
  navSystem: "系统",

  // brand / chrome
  brandSubtitle: "短剧运营后台",
  closeMenu: "关闭菜单",
  openMenu: "打开菜单",
  interfaceLanguage: "界面语言",
  interfaceLanguageHint: "仅影响运营后台界面，不影响用户内容语言。",
  languageZh: "中文",
  languageEn: "English",

  // common actions
  todos: "待办",
  pendingDramas: "待审短剧",
  pendingWithdraws: "提现",
  reconcileMismatch: "对账差异",
  transcodeFailed: "转码失败",
  overdue: ">24h",
  refresh: "刷新",
  loading: "加载中…",
  backSite: "回前台",
  logout: "退出",
  exportCsv: "导出 CSV",
  search: "搜索",
  query: "查询",
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
  details: "详情",
  totalCount: "共 {n}",
  slaWarn: "超 24h",
  enable: "启用",
  disable: "停用",
  onShelf: "上架",
  offShelf: "下架",
  close: "关闭",
  generate: "生成",
  submit: "提交",
  prevPage: "上一页",
  nextPage: "下一页",
  dryRun: "试运行",
  confirm: "确认",

  // common columns
  colId: "ID",
  colUser: "用户",
  colLocale: "语言",
  colRegion: "地区",
  colCredits: "积分",
  colCreated: "创建时间",
  colUpdated: "更新时间",
  colOrderNo: "订单号",
  colType: "类型",
  colPay: "支付方式",
  colAmount: "金额",
  colVndCredits: "₫ / 积分",
  colNote: "备注",
  colRemark: "备注",
  colAfter: "变动后",
  colActor: "操作人",
  colTarget: "对象",
  colResult: "结果",
  colPayload: "详情",
  colAction: "动作",
  colCurrency: "币种",
  colDate: "日期",
  colProvider: "渠道",
  colLocal: "本地",
  colRemote: "远端",
  colDiff: "差额",
  colCreator: "创作者",
  colDramas: "剧集数",
  colKyc: "KYC",
  colTitle: "标题",
  colName: "名称",
  colSlug: "标识",
  colSort: "排序",
  colNameVi: "越南语名称",
  colNameZh: "中文名称",
  colRequestNo: "申请号",
  colGmv: "GMV",
  colViews: "浏览",
  colUnlocks: "解锁",
  colHomeFlags: "首页标记",
  colViewsUnlocks: "浏览 / 解锁",
  colRole: "角色",
  colAdmin: "管理员",
  colBatch: "批次",
  colQty: "数量",
  colCode: "兑换码",
  colExpires: "过期时间",
  colCountry: "国家",
  colCity: "城市",
  colContent: "内容",
  colDays: "天数",
  colPriceCny: "人民币价格",
  colBadge: "徽标",
  colUnusedUsedVoided: "未用 / 已用 / 作废",

  // status labels (display)
  statusAll: "全部",
  statusActive: "正常",
  statusSuspended: "停用",
  statusBanned: "封禁",
  statusPending: "待处理",
  statusApproved: "已通过",
  statusRejected: "已拒绝",

  // dashboard
  kpiNewUsers: "新用户",
  kpiGmv: "GMV ₫",
  kpiUnlocks: "解锁",
  kpiRevenue: "平台收入 ₫",
  kpiOrders: "付费订单",
  bizBreakdown: "经营拆分",
  activeVip: "有效 VIP",
  topupStat: "充值笔数 / 积分",
  vipStat: "VIP 订单 / VND",
  unlockStat: "解锁笔数 / 积分",
  buyoutStat: "买断笔数 / 积分",
  rankings: "内容排行",
  rankByView: "浏览",
  rankByUnlock: "解锁",
  rankBySales: "销售",
  drama: "短剧",
  views: "浏览",
  unlocks: "解锁",
  orderCount: "订单",
  rangeToday: "今日",
  range7d: "7日",
  range30d: "30日",
  trend: "趋势",

  // users
  userSearchPlaceholder: "邮箱 / 手机 / 昵称",
  userDetail: "用户详情",
  creditBalance: "积分余额",
  totalRecharged: "累计充值",
  totalSpent: "累计消费",
  statusChangeReason: "状态变更理由",
  forceLogout: "强制登出",
  extendVip: "延长 VIP",
  setExpire: "设置到期",
  clearVip: "清空 VIP",
  adjustCreditsPlaceholder: "±积分",
  adjustReasonPlaceholder: "调账理由",
  adjustBalance: "调整余额",

  // user overview
  userStatsTotal: "用户总数",
  userStatsLoggedIn: "登录用户",
  userStatsNew: "新增用户",
  userStatsPaidUsers: "付费用户数",
  userStatsTotalPaid: "付费总额",
  userStatsTotalUsage: "总用量",
  userStatsActiveVip: "有效 VIP",
  userStatsRangeHint: "统计范围应用于登录用户、新增用户、趋势与环比",
  userStatsTotalDesc: "当前全部账号",
  userStatsLoggedInDesc: "所选时段内有登录会话的用户",
  userStatsNewDesc: "所选时段内注册",
  userStatsPaidUsersDesc: "占用户总数",
  userStatsTotalPaidDesc: "累计付款金额（全平台，不限时段）",
  userStatsUsageDesc: "全平台累计消费积分",
  userStatsVipDesc: "当前 VIP 未过期",
  userStatsRegTrend: "注册趋势",
  userStatsRegTrendDesc: "所选时段每日新增用户",
  userStatsLocaleDist: "语言分布",
  userStatsLocaleDistDesc: "按界面语言统计用户占比",
  rangeCustom: "自定义",
  rangeApply: "应用",
  localeVi: "越南语",
  localeZh: "中文",
  localeOther: "其他",
  comparedPrevPeriod: "较上周期",

  // orders / refunds
  markPaid: "入账",
  externalRef: "外部单号",
  emptyRefunds: "暂无退款工单",

  // wallet
  manualAdjust: "人工调账",
  submitAdjust: "提交调账",
  walletUserId: "用户 ID",

  // creators / withdraws
  withdrawable: "可提现",
  goKycReview: "去 KYC 审核",
  applyAmount: "申请额",
  afterTax: "税后",

  // reconcile
  reconcileDate: "对账日期",
  settleHint: "结算说明",

  // settings
  ratesHint:
    "含义：1 人民币 = N 该币种。例：1 CNY = 3500 VND → ¥10 套餐应付 35000 VND，到账积分仍以套餐为准。",
  ratePreview: "预览：¥10 ≈ {n} {currency}",
  currentRates: "当前汇率",
  rateHistory: "变更历史（审计）",
  validateFailed: "校验失败",
  cnyEquals: "1 CNY =",

  // categories / content
  searchTitleSlugCreator: "标题 / slug / 创作者",
  isActive: "是否启用",

  // redeem
  batchName: "批次名称",
  voidUnused: "作废未用码",
  voidSelected: "作废已选 ({n})",
  daysUnit: "{n}天",
  creditsUnit: "{n}积分",

  // login
  loginTitle: "运营后台登录",
  loginAccount: "账号",
  loginPassword: "密码",
  loginCaptcha: "验证码",
  loginSubmit: "登录",
  loginFailed: "登录失败",
  loginBadCredentials: "账号或密码错误",
  loginCaptchaError: "验证码错误或已过期",
  loginCaptchaLoadFailed: "验证码加载失败",
  refreshCaptcha: "刷新验证码",

  // packages / vip
  packageName: "套餐名称",
  vipName: "会员名称",

  // generic toggles / misc
  on: "开",
  off: "关",
  yes: "是",
  no: "否",
  ipAddress: "IP 地址",
  recentTransactions: "近期流水",
  ordersSection: "订单",
  sessions: "会话",
  registeredAt: "注册时间",
  vipExpiry: "VIP 到期",
  notActivated: "未开通",
  rejectReasonPlaceholder: "拒绝理由",
  backToList: "返回列表",
  backToUsers: "返回用户列表",
  backToCreators: "返回创作者列表",
  reasonPlaceholder: "理由",

  // creators
  pendingCreators: "待审创作者",
  pendingCreatorsHint: "仅展示 KYC 状态为 PENDING 的创作者。",
  creatorSearchPlaceholder: "创作者名 / 邮箱",
  cccdFront: "正面",
  cccdBack: "背面",
  earningsFrozen: "冻结中",
  earningsWithdrawn: "已提现",
  earningsTotal: "累计",
  totalEarned: "累计收入",
  creatorDetail: "创作者详情",
  creatorIncome: "创作者收入",
  monthIncome: "本月收入",
  paidOrdersLabel: "已支付订单",
  incomeByDrama: "按剧收益",
  emptyIncomeData: "暂无收益数据",

  // content / dramas
  allCategories: "全部分类",
  official: "官方",
  featuredFlag: "首页推荐",
  batchApply: "批量应用",
  selectAllPage: "全选本页",
  selectedCount: "已选 {n}",
  freeEpisodes: "免费集数",
  priceCreditsPerEpisode: "单集积分",
  buyoutCreditsLabel: "买断积分（0=关闭）",
  pageNumber: "第 {n} 页",
  episodeNumber: "集数",
  free: "免费",
  transcodeStatus: "转码",
  thumbnailUrl: "封面 URL",
  retryTranscode: "重试转码",
  dramaDetail: "短剧详情",
  favorites: "收藏",
  episodeCount: "分集",
  category: "分类",
  actionReasonPlaceholder: "操作理由（上下架必填）",
  approveReview: "审核通过",
  forceOffline: "强制下架",
  restoreOnline: "恢复上架",
  confirmDeleteDrama: "确认删除该短剧？此操作不可恢复。",
  heroHintBanners:
    "启用且在有效期内的 Banner 会优先驱动 PC 首页 Hero 轮播；未配置 Banner 时回退到「推荐位 / 官方短剧」权重排序。",
  heroHintContent:
    "首页 Hero：有启用 Banner 时优先展示 Banner；否则开启「推荐」或「官方」的已上架短剧进入轮播，权重越大越靠前。",
  heroHintFeatured:
    "集中管理首页推荐 / 官方短剧与轮播权重。权重越大越靠前；若配置了 Banner，C 端 Hero 优先展示 Banner。",
  heroHintHottest:
    "管理剧场「最热」运营位：从已上架短剧中添加，并用上移/下移调整展示顺序。排序数字越小越靠前。",
  hottestCurrent: "当前最热列表",
  hottestAddFromAll: "从全量添加",
  hottestSearchPlaceholder: "搜索标题 / slug / 创作者",
  hottestSearchHint: "输入关键词搜索已上架短剧后添加。",
  hottestEmpty: "暂未配置最热剧集",
  hottestEmptyHint: "点击右上角「从全量添加」，从已上架短剧中挑选并调整顺序。",
  hottestSearchNoResult: "未找到匹配的已上架短剧，试试其他关键词。",
  hottestConfirmRemove: "确认将「{title}」移出最热列表？",
  moveUp: "上移",
  moveDown: "下移",
  remove: "移除",
  add: "添加",
  alreadyAdded: "已添加",
  saveSortWeight: "保存轮播权重",
  saveFreeEpisodes: "保存免费集数",
  episodeManagement: "分集管理",
  emptyEpisodes: "暂无分集",
  reverseEpisodeOrder: "反转分集顺序",
  sortWeightTitle: "首页轮播权重",
  flagsLabel: "标记",
  weightLabel: "权重",
  scheduleLabel: "投放时间",

  // dashboard extra
  vsLastPeriod: "环比",

  // banners
  confirmDeleteBanner: "确定删除此横幅？",
  bannerTitleVi: "越南语标题",
  bannerTitleZh: "中文标题",
  imageUrlLabel: "图片 URL",
  linkUrlLabel: "链接 URL",
  dramaIdLabel: "短剧 ID",
  startAtLabel: "开始时间",
  endAtLabel: "结束时间",

  // packages / vip plans extra
  packagePriceHint: "套餐以人民币定价；用户选其它币种时按「法币汇率」自动折算，到账积分不变。",
  vipPriceHint: "VIP 套餐以人民币定价；支付成功后按天数延长会员，可叠加。",
  planCount: "套餐数",
  liveCount: "上架中",
  pricingCurrency: "定价币种",

  // messages
  broadcastHint: "向指定用户或全量活跃用户发送站内信。全量广播最多覆盖 5000 名活跃用户。",
  broadcastAll: "广播给全部活跃用户",
  userIdLabel: "用户 ID",
  userIdPlaceholder: "数字 userId",
  titleViLabel: "标题（VI）",
  titleZhLabel: "标题（ZH）",
  bodyViLabel: "正文（VI）",
  bodyZhLabel: "正文（ZH）",
  confirmBroadcast: "确认向全部活跃用户广播？",
  sending: "发送中…",
  sendMessage: "发送站内信",
  createdNotifications: "已创建 {n} 条通知",

  // redeem codes
  redeemHint: "批量生成 VIP 或积分卡密。明文仅在创建时展示一次，请立即复制或导出 CSV。",
  plaintextCodesTitle: "明文卡密（仅此一次）",
  tabBatches: "批次",
  tabCodes: "兑换码",
  tabRedemptions: "兑换记录",

  // content import
  importFolderTitle: "上传文件夹",
  importFolderHint: "选择短剧目录（浏览器需支持目录上传）。建议先 dry-run 预览，再正式导入。",
  dryRunPreview: "Dry-run 预览",
  confirmImport: "确认导入",
  localPathTitle: "服务器本地路径",
  localPathHint: "扫描 API 机器上的导入根目录（MEDIA_ROOT / ADMIN_IMPORT_ROOT）。留空使用默认路径。",
  localPathPlaceholder: "可选：绝对路径",
  selectFolderFirst: "请先选择文件夹",
  importSummary: "扫描 {scanned} · 导入 {imported} · 跳过 {skipped}",

  // reconcile / settle
  settleDescription: "手动触发创作者收益 T+7 结算。定时任务会自动跑；此处用于补跑或立刻结算。",
  settleWindowDays: "结算窗口（天）",
  settling: "结算中…",
  runSettleT7: "执行 T+7 结算",
  rerunReconcile: "重新对账",
  reconcileTab: "对账",

  // categories / wallet validation
  slugRequired: "slug 必填",
  userIdRequired: "请填写 userId",
  manualAdjustSuper: "人工调账（SUPER_ADMIN）",

  // login
  loggingIn: "登录中…",
  accountPlaceholder: "请输入账号",
  passwordPlaceholder: "请输入密码",
  captchaPlaceholder: "请输入验证码",
  loginFooterHint: "登录后将校验管理员权限，非授权账号无法访问后台功能。",
  loginSubheading: "使用管理员账号进入控制台",
} as const;

export type LabelKey = keyof typeof zh;

const en: Record<LabelKey, string> = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  content: "Dramas",
  contentPending: "Content review",
  contentImport: "Bulk import",
  categories: "Categories",
  banners: "Home banners",
  featured: "Featured",
  hottest: "Hottest dramas",
  messages: "Push messages",
  users: "Users",
  userOverview: "User overview",
  usersBanned: "Bans & risk",
  orders: "Orders",
  refunds: "Refunds",
  packages: "Top-up packages",
  vipPlans: "VIP plans",
  redeemCodes: "Redeem codes",
  creators: "Creators",
  kyc: "KYC review",
  withdraws: "Withdrawals",
  wallet: "Wallet ledger",
  reconcile: "Reconcile",
  settle: "T+7 settle",
  rates: "FX rates",
  admins: "Admins",
  audit: "Audit log",
  settings: "System settings",

  navWorkspace: "Workspace",
  navContent: "Content",
  navOps: "Operations",
  navUsers: "Users",
  navTrade: "Commerce",
  navCreators: "Creators",
  navFinance: "Finance",
  navSystem: "System",

  brandSubtitle: "Short drama ops console",
  closeMenu: "Close menu",
  openMenu: "Open menu",
  interfaceLanguage: "Interface language",
  interfaceLanguageHint: "Affects the admin UI only, not end-user content language.",
  languageZh: "中文",
  languageEn: "English",

  todos: "To-dos",
  pendingDramas: "Pending dramas",
  pendingWithdraws: "Withdrawals",
  reconcileMismatch: "Reconcile diffs",
  transcodeFailed: "Transcode failed",
  overdue: ">24h",
  refresh: "Refresh",
  loading: "Loading…",
  backSite: "Back to site",
  logout: "Log out",
  exportCsv: "Export CSV",
  search: "Search",
  query: "Search",
  filter: "Filter",
  status: "Status",
  all: "All",
  pending: "Pending",
  approve: "Approve",
  reject: "Reject",
  save: "Save",
  create: "Create",
  update: "Update",
  cancel: "Cancel",
  delete: "Delete",
  edit: "Edit",
  empty: "No data",
  actions: "Actions",
  time: "Time",
  details: "Details",
  totalCount: "Total {n}",
  slaWarn: ">24h",
  enable: "Enabled",
  disable: "Disabled",
  onShelf: "Live",
  offShelf: "Off",
  close: "Close",
  generate: "Generate",
  submit: "Submit",
  prevPage: "Prev",
  nextPage: "Next",
  dryRun: "Dry-run",
  confirm: "Confirm",

  colId: "ID",
  colUser: "User",
  colLocale: "Locale",
  colRegion: "Region",
  colCredits: "Credits",
  colCreated: "Created",
  colUpdated: "Updated",
  colOrderNo: "Order No.",
  colType: "Type",
  colPay: "Pay method",
  colAmount: "Amount",
  colVndCredits: "₫ / credits",
  colNote: "Note",
  colRemark: "Remark",
  colAfter: "After",
  colActor: "Actor",
  colTarget: "Target",
  colResult: "Result",
  colPayload: "Payload",
  colAction: "Action",
  colCurrency: "Currency",
  colDate: "Date",
  colProvider: "Provider",
  colLocal: "Local",
  colRemote: "Remote",
  colDiff: "Diff",
  colCreator: "Creator",
  colDramas: "Dramas",
  colKyc: "KYC",
  colTitle: "Title",
  colName: "Name",
  colSlug: "Slug",
  colSort: "Sort",
  colNameVi: "Name (VI)",
  colNameZh: "Name (ZH)",
  colRequestNo: "Request No.",
  colGmv: "GMV",
  colViews: "Views",
  colUnlocks: "Unlocks",
  colHomeFlags: "Home flags",
  colViewsUnlocks: "Views / unlocks",
  colRole: "Role",
  colAdmin: "Admin",
  colBatch: "Batch",
  colQty: "Qty",
  colCode: "Code",
  colExpires: "Expires",
  colCountry: "Country",
  colCity: "City",
  colContent: "Content",
  colDays: "Days",
  colPriceCny: "Price (CNY)",
  colBadge: "Badge",
  colUnusedUsedVoided: "Unused / used / void",

  statusAll: "All",
  statusActive: "Active",
  statusSuspended: "Suspended",
  statusBanned: "Banned",
  statusPending: "Pending",
  statusApproved: "Approved",
  statusRejected: "Rejected",

  kpiNewUsers: "New users",
  kpiGmv: "GMV ₫",
  kpiUnlocks: "Unlocks",
  kpiRevenue: "Platform revenue ₫",
  kpiOrders: "Paid orders",
  bizBreakdown: "Business breakdown",
  activeVip: "Active VIP",
  topupStat: "Top-ups / credits",
  vipStat: "VIP orders / VND",
  unlockStat: "Unlocks / credits",
  buyoutStat: "Buyouts / credits",
  rankings: "Content ranking",
  rankByView: "Views",
  rankByUnlock: "Unlocks",
  rankBySales: "Sales",
  drama: "Drama",
  views: "Views",
  unlocks: "Unlocks",
  orderCount: "Orders",
  rangeToday: "Today",
  range7d: "7 days",
  range30d: "30 days",
  trend: "Trend",

  userSearchPlaceholder: "email / phone / nick",
  userDetail: "User detail",
  creditBalance: "Credit balance",
  totalRecharged: "Total recharged",
  totalSpent: "Total spent",
  statusChangeReason: "Status change reason",
  forceLogout: "Force logout",
  extendVip: "Extend VIP",
  setExpire: "Set expiry",
  clearVip: "Clear VIP",
  adjustCreditsPlaceholder: "± credits",
  adjustReasonPlaceholder: "Adjust reason",
  adjustBalance: "Adjust balance",

  userStatsTotal: "Total users",
  userStatsLoggedIn: "Logged-in users",
  userStatsNew: "New users",
  userStatsPaidUsers: "Paid users",
  userStatsTotalPaid: "Total paid",
  userStatsTotalUsage: "Total usage",
  userStatsActiveVip: "Active VIP",
  userStatsRangeHint: "Range applies to logins, new users, trend, and comparison",
  userStatsTotalDesc: "All current accounts",
  userStatsLoggedInDesc: "Users with a login session in the selected range",
  userStatsNewDesc: "Registered in the selected range",
  userStatsPaidUsersDesc: "Share of total users",
  userStatsTotalPaidDesc: "Lifetime payment amount (all-time, platform-wide)",
  userStatsUsageDesc: "Sum of lifetime spent credits",
  userStatsVipDesc: "Users with unexpired VIP",
  userStatsRegTrend: "Registration trend",
  userStatsRegTrendDesc: "Daily new users in the selected range",
  userStatsLocaleDist: "Locale distribution",
  userStatsLocaleDistDesc: "Users by interface language",
  rangeCustom: "Custom",
  rangeApply: "Apply",
  localeVi: "Vietnamese",
  localeZh: "Chinese",
  localeOther: "Other",
  comparedPrevPeriod: "vs prior period",

  markPaid: "Mark paid",
  externalRef: "External ref",
  emptyRefunds: "No refund tickets",

  manualAdjust: "Manual adjust",
  submitAdjust: "Submit adjust",
  walletUserId: "User ID",

  withdrawable: "Withdrawable",
  goKycReview: "Go to KYC review",
  applyAmount: "Requested",
  afterTax: "After tax",

  reconcileDate: "Reconcile date",
  settleHint: "Settlement notes",

  ratesHint:
    "Meaning: 1 CNY = N units of the target currency. Example: 1 CNY = 3500 VND → a ¥10 package costs 35000 VND; credits still follow the package.",
  ratePreview: "Preview: ¥10 ≈ {n} {currency}",
  currentRates: "Current rates",
  rateHistory: "Change history (audit)",
  validateFailed: "Validation failed",
  cnyEquals: "1 CNY =",

  searchTitleSlugCreator: "Title / slug / creator",
  isActive: "Active",

  batchName: "Batch name",
  voidUnused: "Void unused",
  voidSelected: "Void selected ({n})",
  daysUnit: "{n} days",
  creditsUnit: "{n} credits",

  loginTitle: "Ops console login",
  loginAccount: "Account",
  loginPassword: "Password",
  loginCaptcha: "Captcha",
  loginSubmit: "Sign in",
  loginFailed: "Sign-in failed",
  loginBadCredentials: "Invalid account or password",
  loginCaptchaError: "Captcha invalid or expired",
  loginCaptchaLoadFailed: "Failed to load captcha",
  refreshCaptcha: "Refresh captcha",

  packageName: "Package name",
  vipName: "Plan name",

  on: "On",
  off: "Off",
  yes: "Yes",
  no: "No",
  ipAddress: "IP address",
  recentTransactions: "Recent transactions",
  ordersSection: "Orders",
  sessions: "Sessions",
  registeredAt: "Registered",
  vipExpiry: "VIP expiry",
  notActivated: "Not activated",
  rejectReasonPlaceholder: "Reject reason",
  backToList: "Back to list",
  backToUsers: "Back to users",
  backToCreators: "Back to creators",
  reasonPlaceholder: "Reason",

  pendingCreators: "Pending creators",
  pendingCreatorsHint: "Only creators with KYC status PENDING are shown.",
  creatorSearchPlaceholder: "name / email",
  cccdFront: "Front",
  cccdBack: "Back",
  earningsFrozen: "Frozen",
  earningsWithdrawn: "Withdrawn",
  earningsTotal: "Total",
  totalEarned: "Total earned",
  creatorDetail: "Creator detail",
  creatorIncome: "Creator income",
  monthIncome: "This month",
  paidOrdersLabel: "Paid orders",
  incomeByDrama: "Income by drama",
  emptyIncomeData: "No income data",

  allCategories: "All categories",
  official: "Official",
  featuredFlag: "Featured",
  batchApply: "Apply to batch",
  selectAllPage: "Select all (page)",
  selectedCount: "Selected {n}",
  freeEpisodes: "Free episodes",
  priceCreditsPerEpisode: "Credits per episode",
  buyoutCreditsLabel: "Buyout credits (0 = off)",
  pageNumber: "Page {n}",
  episodeNumber: "Episode #",
  free: "Free",
  transcodeStatus: "Transcode",
  thumbnailUrl: "Thumbnail URL",
  retryTranscode: "Retry transcode",
  dramaDetail: "Drama detail",
  favorites: "Favorites",
  episodeCount: "Episodes",
  category: "Category",
  actionReasonPlaceholder: "Action reason (required for shelf changes)",
  approveReview: "Approve",
  forceOffline: "Force offline",
  restoreOnline: "Restore online",
  confirmDeleteDrama: "Delete this drama? This action cannot be undone.",
  heroHintBanners:
    "Active banners within their schedule drive the PC home hero carousel; without a banner it falls back to featured/official drama weight ordering.",
  heroHintContent:
    "Home hero: shows an active banner if configured; otherwise live dramas flagged Featured or Official enter the carousel, higher weight first.",
  heroHintFeatured:
    "Manage featured/official dramas and carousel weight here. Higher weight ranks first; if a banner is configured, it takes priority on the storefront hero.",
  heroHintHottest:
    "Curate the Theater “Hottest” shelf: add from live dramas and reorder with move up/down. Lower sort index appears first.",
  hottestCurrent: "Current hottest list",
  hottestAddFromAll: "Add from catalog",
  hottestSearchPlaceholder: "Search title / slug / creator",
  hottestSearchHint: "Search live dramas by keyword, then add them.",
  hottestEmpty: "No hottest dramas yet",
  hottestEmptyHint: "Use “Add from catalog” to pick live dramas and reorder them.",
  hottestSearchNoResult: "No live dramas matched. Try another keyword.",
  hottestConfirmRemove: "Remove “{title}” from the hottest list?",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  add: "Add",
  alreadyAdded: "Added",
  saveSortWeight: "Save carousel weight",
  saveFreeEpisodes: "Save free episodes",
  episodeManagement: "Episode management",
  emptyEpisodes: "No episodes",
  reverseEpisodeOrder: "Reverse episode order",
  sortWeightTitle: "Home carousel weight",
  flagsLabel: "Flags",
  weightLabel: "Weight",
  scheduleLabel: "Schedule",

  vsLastPeriod: "vs. prior period",

  confirmDeleteBanner: "Delete this banner?",
  bannerTitleVi: "Title (VI)",
  bannerTitleZh: "Title (ZH)",
  imageUrlLabel: "Image URL",
  linkUrlLabel: "Link URL",
  dramaIdLabel: "Drama ID",
  startAtLabel: "Start time",
  endAtLabel: "End time",

  packagePriceHint:
    "Packages are priced in CNY; other currencies auto-convert via FX rate, credited amounts stay unchanged.",
  vipPriceHint:
    "VIP plans are priced in CNY; a successful payment extends membership by days, and durations stack.",
  planCount: "Plans",
  liveCount: "Live",
  pricingCurrency: "Pricing currency",

  broadcastHint:
    "Send an in-app message to a specific user or all active users. Broadcasts reach up to 5,000 active users.",
  broadcastAll: "Broadcast to all active users",
  userIdLabel: "User ID",
  userIdPlaceholder: "numeric user ID",
  titleViLabel: "Title (VI)",
  titleZhLabel: "Title (ZH)",
  bodyViLabel: "Body (VI)",
  bodyZhLabel: "Body (ZH)",
  confirmBroadcast: "Broadcast to all active users?",
  sending: "Sending…",
  sendMessage: "Send message",
  createdNotifications: "Created {n} notifications",

  redeemHint:
    "Bulk-generate VIP or credits codes. Plaintext codes are shown only once — copy or export immediately.",
  plaintextCodesTitle: "Plaintext codes (shown once)",
  tabBatches: "Batches",
  tabCodes: "Codes",
  tabRedemptions: "Redemptions",

  importFolderTitle: "Upload folder",
  importFolderHint:
    "Select a drama folder (browser must support directory upload). Try a dry run before importing for real.",
  dryRunPreview: "Dry-run preview",
  confirmImport: "Confirm import",
  localPathTitle: "Server local path",
  localPathHint:
    "Scan the import root on the API server (MEDIA_ROOT / ADMIN_IMPORT_ROOT). Leave blank to use the default path.",
  localPathPlaceholder: "Optional: absolute path",
  selectFolderFirst: "Please select a folder first",
  importSummary: "Scanned {scanned} · imported {imported} · skipped {skipped}",

  settleDescription:
    "Manually trigger the T+7 creator payout settlement. The scheduled job runs automatically; use this to backfill or settle immediately.",
  settleWindowDays: "Settlement window (days)",
  settling: "Settling…",
  runSettleT7: "Run T+7 settlement",
  rerunReconcile: "Re-run reconcile",
  reconcileTab: "Reconcile",

  slugRequired: "Slug is required",
  userIdRequired: "Please enter userId",
  manualAdjustSuper: "Manual adjustment (SUPER_ADMIN)",

  loggingIn: "Signing in…",
  accountPlaceholder: "Enter your account",
  passwordPlaceholder: "Enter your password",
  captchaPlaceholder: "Enter the captcha",
  loginFooterHint:
    "After signing in, admin permissions are verified; unauthorized accounts cannot access console features.",
  loginSubheading: "Sign in with your admin account",
};

const dictionaries: Record<AdminLocale, Record<LabelKey, string>> = { zh, en };

let currentLocale: AdminLocale = DEFAULT_LOCALE;

export function normalizeAdminLocale(value: unknown): AdminLocale {
  return value === "en" ? "en" : "zh";
}

export function getAdminLocale(): AdminLocale {
  return currentLocale;
}

function readStoredLocale(): AdminLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return normalizeAdminLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function persistLocale(locale: AdminLocale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "en" ? "en" : "zh";
  }
}

function resolveKey(key: string): LabelKey | null {
  const raw = key.startsWith("admin.") ? key.slice(6) : key;
  return raw in zh ? (raw as LabelKey) : null;
}

function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] == null ? `{${name}}` : String(vars[name]),
  );
}

export function translate(
  locale: AdminLocale,
  key: string,
  vars?: Record<string, string | number>,
) {
  const labelKey = resolveKey(key);
  const dict = dictionaries[locale];
  const text = labelKey ? dict[labelKey] : key;
  return format(text, vars);
}

/** Non-reactive helper; prefer `useI18n().t` in components so UI updates on switch. */
export function t(key: string, vars?: Record<string, string | number>) {
  return translate(currentLocale, key, vars);
}

type I18nContextValue = {
  locale: AdminLocale;
  setLocale: (locale: AdminLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function AdminI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminLocale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readStoredLocale();
    currentLocale = next;
    setLocaleState(next);
    persistLocale(next);
    setReady(true);
  }, []);

  const setLocale = useCallback((next: AdminLocale) => {
    const normalized = normalizeAdminLocale(next);
    currentLocale = normalized;
    persistLocale(normalized);
    setLocaleState(normalized);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  // Avoid flash of wrong language after hydration when stored locale differs from default.
  if (!ready && typeof window !== "undefined") {
    // still render; stored locale applied in effect
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: currentLocale,
      setLocale: (next: AdminLocale) => {
        currentLocale = normalizeAdminLocale(next);
        persistLocale(currentLocale);
      },
      t: (key: string, vars?: Record<string, string | number>) =>
        translate(currentLocale, key, vars),
    } satisfies I18nContextValue;
  }
  return ctx;
}

export function statusLabel(tFn: I18nContextValue["t"], status?: string | null) {
  switch (status) {
    case "ALL":
      return tFn("statusAll");
    case "ACTIVE":
      return tFn("statusActive");
    case "SUSPENDED":
      return tFn("statusSuspended");
    case "BANNED":
      return tFn("statusBanned");
    case "PENDING":
    case "PENDING_REVIEW":
      return tFn("statusPending");
    case "APPROVED":
      return tFn("statusApproved");
    case "REJECTED":
      return tFn("statusRejected");
    default:
      return status || "—";
  }
}
