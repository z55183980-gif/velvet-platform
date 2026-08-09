/**
 * Shared Ops list styles — visual parity with 剧集管理 / 用户管理.
 *
 * - Tabs & 查询: `@velvet/ui` Button `primary` / `secondary`.
 * - 通过 / 批准: `success`；驳回: `danger`。
 * - Identity links (创作者名等): brand text chain below.
 */

/** Ghost Button override → brand text link (no lift / fill). Used for ops that stay text-like (e.g. 关闭账号). */
export const ADMIN_TEXT_ACTION_CLASS =
  "h-auto min-h-0 gap-0 px-0 py-0 text-body-sm font-medium text-brand shadow-none hover:bg-transparent hover:text-brand hover:underline hover:translate-y-0 hover:shadow-none disabled:opacity-50";

/** Same look on `<Link>` / `<a>` (no Button wrapper). */
export const ADMIN_TEXT_LINK_CLASS =
  "inline-flex items-center text-body-sm font-medium text-brand hover:underline";
