import { asRows, toQuery } from "../types";
import { adminDownloadBlob, adminRequest, type AdminProfile } from "./http";
import { clearAdminToken, setAdminToken } from "./http";

export async function adminLogin(account: string, password: string) {
  const data = await adminRequest<{ token: string; admin: AdminProfile }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ account, password }),
  });
  setAdminToken(data.token);
  return data;
}

export async function adminLogout() {
  try {
    await adminRequest<{ success: boolean }>("/admin/auth/logout", { method: "POST", body: "{}" });
  } catch {
    /* ignore */
  }
  clearAdminToken();
}

export async function adminMe() {
  return adminRequest<AdminProfile>("/admin/auth/me");
}

export async function adminChangePassword(oldPassword: string, newPassword: string) {
  return adminRequest<{ success: boolean }>("/admin/auth/password", {
    method: "PATCH",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

export async function adminUpdateProfile(input: {
  email?: string;
  username?: string;
  displayName?: string;
}) {
  return adminRequest<AdminProfile>("/admin/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function adminDashboard() {
  return adminRequest("/admin/dashboard/overview");
}

export async function adminListDramas(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/dramas${toQuery(params)}`);
}

export async function adminGetDrama(id: string) {
  return adminRequest(`/admin/dramas/${id}`);
}

export async function adminUpdateDrama(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/dramas/${id}/update`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminApproveDrama(id: string) {
  return adminRequest(`/admin/dramas/${id}/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectDrama(id: string, reason?: string) {
  return adminRequest(`/admin/dramas/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminOfflineDrama(id: string, reason: string) {
  return adminRequest(`/admin/dramas/${id}/offline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminOnlineDrama(id: string, reason: string) {
  return adminRequest(`/admin/dramas/${id}/online`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminSetFeatured(id: string, value: boolean) {
  return adminRequest(`/admin/dramas/${id}/featured`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function adminSetOfficial(id: string, value: boolean) {
  return adminRequest(`/admin/dramas/${id}/official`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function adminSetSortWeight(id: string, weight: number) {
  return adminRequest(`/admin/dramas/${id}/sort-weight`, {
    method: "POST",
    body: JSON.stringify({ weight }),
  });
}

export async function adminDramaEpisodes(id: string) {
  return adminRequest(`/admin/dramas/${id}/episodes`);
}

export async function adminUpdateEpisode(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/episodes/${id}/update`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function adminReorderEpisodes(dramaId: string, ids: string[]) {
  return adminRequest(`/admin/dramas/${dramaId}/episodes/reorder`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function adminRetryTranscode(id: string) {
  return adminRequest(`/admin/episodes/${id}/transcode-retry`, { method: "POST", body: "{}" });
}

export async function adminBatchDramas(body: {
  ids: (string | number)[];
  freeEpisodeCount?: number;
  priceCredits?: number;
  buyoutCredits?: number | null;
}) {
  return adminRequest("/admin/dramas/batch", { method: "PATCH", body: JSON.stringify(body) });
}

export async function adminListBanners(all = true) {
  const data = await adminRequest(`/admin/banners?all=${all ? "1" : "0"}`);
  return asRows(data);
}

export async function adminCreateBanner(body: Record<string, unknown>) {
  return adminRequest("/admin/banners", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateBanner(id: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/banners/${id}`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminDeleteBanner(id: string) {
  return adminRequest(`/admin/banners/${id}/delete`, { method: "POST", body: "{}" });
}

export async function adminListCategories(all = true) {
  const data = await adminRequest(`/admin/categories?all=${all ? "1" : "0"}`);
  return asRows(data);
}

export async function adminCreateCategory(body: Record<string, unknown>) {
  return adminRequest("/admin/categories", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateCategory(slug: string, body: Record<string, unknown>) {
  return adminRequest(`/admin/categories/${slug}`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminDeleteCategory(slug: string) {
  return adminRequest(`/admin/categories/${slug}/delete`, { method: "POST", body: "{}" });
}

export async function adminListUsers(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/users${toQuery(params)}`);
}

export async function adminGetUser(id: string) {
  return adminRequest(`/admin/users/${id}`);
}

export async function adminSetUserStatus(id: string, status: string, reason: string) {
  return adminRequest(`/admin/users/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason }),
  });
}

export async function adminForceLogout(id: string) {
  return adminRequest(`/admin/users/${id}/force-logout`, { method: "POST", body: "{}" });
}

export async function adminSetUserVip(
  id: string,
  body: { vipExpireAt?: string | null; extendDays?: number },
) {
  return adminRequest(`/admin/users/${id}/vip`, { method: "POST", body: JSON.stringify(body) });
}

export async function adminListOrders(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/orders${toQuery(params)}`);
}

export async function adminMarkPaid(orderNo: string, externalRef: string) {
  return adminRequest(`/admin/orders/${orderNo}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ externalRef }),
  });
}

export async function adminListRefunds(page = 1, pageSize = 20) {
  return adminRequest(`/admin/refunds/requests?page=${page}&pageSize=${pageSize}`);
}

export async function adminApproveRefund(orderNo: string) {
  return adminRequest(`/admin/refunds/${orderNo}/approve`, { method: "POST", body: "{}" });
}

export async function adminRefuseRefund(orderNo: string, reason: string) {
  return adminRequest(`/admin/refunds/${orderNo}/refuse`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminDownloadCsv(
  kind: "orders" | "withdraws" | "reconciliations",
  filename?: string,
) {
  return adminDownloadBlob(`/admin/exports/${kind}.csv`, filename || `${kind}.csv`);
}

export async function adminListReconciliations(page = 1, pageSize = 30) {
  return adminRequest(`/admin/reconciliations?page=${page}&pageSize=${pageSize}`);
}

export async function adminRerunReconcile(days = 1) {
  return adminRequest(`/admin/reconciliations/rerun?days=${days}`, {
    method: "POST",
    body: "{}",
  });
}

export async function adminListAuditLogs(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/audit-logs${toQuery(params)}`);
}

export async function adminListWithdraws(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/withdraws/list${toQuery(params)}`);
}

export async function adminPendingWithdraws(overdueHours?: number) {
  return adminRequest(
    `/admin/withdraws/pending${overdueHours != null ? `?overdueHours=${overdueHours}` : ""}`,
  );
}

export async function adminApproveWithdraw(id: string) {
  return adminRequest(`/admin/withdraws/${id}/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectWithdraw(id: string, reason?: string) {
  return adminRequest(`/admin/withdraws/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminListKyc(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/kyc/list${toQuery(params)}`);
}

export async function adminApproveKyc(id: string) {
  return adminRequest(`/admin/creators/${id}/kyc/approve`, { method: "POST", body: "{}" });
}

export async function adminRejectKyc(id: string, reason: string) {
  return adminRequest(`/admin/creators/${id}/kyc/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function adminWalletLedger(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/wallet/ledger${toQuery(params)}`);
}

export async function adminWalletAdjust(
  userId: string,
  deltaCredits: number,
  reason: string,
  remark?: string,
) {
  return adminRequest(`/admin/wallet/adjust?userId=${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({ deltaCredits, reason, remark }),
  });
}

export async function adminListRates() {
  return adminRequest("/admin/exchange-rates");
}

export async function adminSetRate(body: {
  currency: string;
  cnyToFiat: number;
  sellRate?: number;
}) {
  return adminRequest("/admin/exchange-rates", { method: "POST", body: JSON.stringify(body) });
}

export async function adminListPackages() {
  return adminRequest("/admin/topup-packages");
}

export async function adminCreatePackage(body: {
  name?: string;
  credits: number;
  basePrice: number;
  sortOrder?: number;
  active?: boolean;
}) {
  return adminRequest("/admin/topup-packages", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdatePackage(
  id: string,
  body: Partial<{
    name: string;
    credits: number;
    basePrice: number;
    sortOrder: number;
    active: boolean;
  }>,
) {
  return adminRequest(`/admin/topup-packages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function adminListVipPlans() {
  return adminRequest("/admin/vip-plans");
}

export async function adminCreateVipPlan(body: {
  name?: string;
  durationDays: number;
  basePrice: number;
  sortOrder?: number;
  badge?: string;
  active?: boolean;
}) {
  return adminRequest("/admin/vip-plans", { method: "POST", body: JSON.stringify(body) });
}

export async function adminUpdateVipPlan(
  id: string,
  body: Partial<{
    name: string;
    durationDays: number;
    basePrice: number;
    sortOrder: number;
    badge: string;
    active: boolean;
  }>,
) {
  return adminRequest(`/admin/vip-plans/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function adminListRedeemBatches(page = 1, pageSize = 20) {
  return adminRequest(`/admin/redeem/batches?page=${page}&pageSize=${pageSize}`);
}

export async function adminCreateRedeemBatch(body: {
  name?: string;
  type: "VIP" | "CREDITS";
  vipDays?: number;
  creditsAmount?: number;
  quantity: number;
  expiresAt?: string;
  note?: string;
}) {
  return adminRequest("/admin/redeem/batches", { method: "POST", body: JSON.stringify(body) });
}

export async function adminVoidRedeemBatch(id: string) {
  return adminRequest(`/admin/redeem/batches/${id}/void`, { method: "POST", body: "{}" });
}

export async function adminListRedeemCodes(
  params: { batchId?: string; status?: string; page?: number; pageSize?: number } = {},
) {
  return adminRequest(`/admin/redeem/codes${toQuery(params)}`);
}

export async function adminVoidRedeemCodes(ids: string[]) {
  return adminRequest("/admin/redeem/codes/void", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function adminListRedemptions(page = 1, pageSize = 20) {
  return adminRequest(`/admin/redeem/redemptions?page=${page}&pageSize=${pageSize}`);
}

export async function adminExportRedeemBatchCsv(batchId: string) {
  return adminDownloadBlob(`/admin/redeem/batches/${batchId}/export.csv`, `redeem-batch-${batchId}.csv`);
}

export async function adminOpsSummary(from?: string, to?: string) {
  return adminRequest(`/admin/ops/summary${toQuery({ from, to })}`);
}

export async function adminOpsDramaSales(from?: string, to?: string, limit = 50) {
  return adminRequest(`/admin/ops/drama-sales${toQuery({ from, to, limit })}`);
}

export async function adminListCreators(params: Record<string, string | number | undefined> = {}) {
  return adminRequest(`/admin/creators${toQuery(params)}`);
}

export async function adminGetCreator(id: string) {
  return adminRequest(`/admin/creators/${id}`);
}

export async function adminListSettings() {
  return adminRequest("/admin/settings");
}

export async function adminUpdateSetting(key: string, value: unknown) {
  return adminRequest("/admin/settings", { method: "POST", body: JSON.stringify({ key, value }) });
}

export async function adminListAdmins() {
  return adminRequest<AdminProfile[]>("/admin/admins");
}

export async function adminSetAdminRole(id: string, role: "SUPER_ADMIN" | "OPS") {
  return adminRequest(`/admin/admins/${id}/role`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export async function adminImportUpload(files: FileList | File[], dryRun: boolean) {
  const list = Array.from(files);
  if (!list.length) throw new Error("未选择文件");
  const form = new FormData();
  form.append("dryRun", dryRun ? "true" : "false");
  for (const file of list) {
    form.append("files", file);
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append("relativePaths", rel);
  }
  return adminRequest("/admin/import/upload", { method: "POST", body: form });
}

export async function adminLocalImport(rootPath?: string, dryRun?: boolean) {
  return adminRequest("/admin/import/local", {
    method: "POST",
    body: JSON.stringify({ rootPath, dryRun }),
  });
}

export async function adminSettleT7(days = 0) {
  return adminRequest(`/admin/settle-t7?days=${days}`, { method: "POST", body: "{}" });
}
