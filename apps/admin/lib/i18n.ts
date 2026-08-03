"use client";

export const labels = {
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
  vipPlans: "VIP 套餐",
  redeemCodes: "卡密",
  ops: "运营",
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
  slaWarn: "超 24h",
} as const;

export type LabelKey = keyof typeof labels;

function resolve(key: string): string {
  if (key.startsWith("admin.")) {
    const k = key.slice(6) as LabelKey;
    return labels[k] ?? key;
  }
  return labels[key as LabelKey] ?? key;
}

export function t(key: string) {
  return resolve(key);
}
