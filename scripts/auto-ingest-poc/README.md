# Velvet 自动入库 POC

最小验证：单个详情页 URL → **DRAFT**（不上架）。

## 流程

1. **Path A**：`yt-dlp/probe` → `yt-dlp/import`（优先）
2. 失败则 **Path B**：抓 HTML → OpenAI 结构化抽取 → `POST /admin/dramas/online`
3. 结果保持 `DRAFT`；详情页「提交审核」→「审核通过」后上架

## 前置

- 本地 API 已启动（默认 `http://127.0.0.1:3001`）
- Node ≥ 18
- Path B 需要 `OPENAI_API_KEY`

## 配置

```bash
cp scripts/auto-ingest-poc/.env.example scripts/auto-ingest-poc/.env
```

编辑 `.env`：

| 变量 | 说明 |
|------|------|
| `API_BASE_URL` | 如 `http://127.0.0.1:3001/api/v1` |
| `ADMIN_TOKEN` | **推荐**：管理端登录后从 localStorage `dv_admin_token` 复制 |
| `ADMIN_ACCOUNT` / `ADMIN_PASSWORD` | 备选登录（需 API 关闭验证码：`AUTH_ADMIN_CAPTCHA_DISABLED=true`） |
| `OPENAI_API_KEY` | Path B 用（可从本机 ZAI `.env` 复制） |
| `OPENAI_BASE_URL` | 可选；兼容网关，默认官方 |
| `OPENAI_MODEL` | 默认见 `.env` |
| `POC_CATEGORY_SLUG` | 默认 `do_thi` |

也可复用 `services/api/.env` 里的 `ADMIN_BOOTSTRAP_*`（脚本会自动尝试加载该文件）。

## 运行

```bash
# 冒烟（只 probe/抽取，不建剧）
node scripts/auto-ingest-poc/ingest.mjs --url "https://example.com/drama/xxx" --dry-run

# 入库 DRAFT（限 5 集冒烟）
node scripts/auto-ingest-poc/ingest.mjs --url "https://example.com/drama/xxx" --max-episodes 5

# 强制 Path B
node scripts/auto-ingest-poc/ingest.mjs --url "..." --force-path b

# 强制 Path A（失败即退出）
node scripts/auto-ingest-poc/ingest.mjs --url "..." --force-path a
```

## 验收清单

对 2 部样本剧（短 ≤10 集、中 10–20 集）记录：

| 项 | 记录 |
|----|------|
| Path A / B | |
| 标题/封面是否可用 | |
| 集数 vs 预期 | |
| 前 3 集 + 末集能否播 | |
| 重复跑是否去重 | |
| 耗时 | |
| 阻塞点 | |

通过后再决定：薄封装 yt-dlp / 引入 AnyCrawl / 试点 Browser-Use。

## 会员站登录态

见 `docs/ytdlp-source-auth.md`：把 Netscape cookies 放到 `{STORAGE_ROOT}/secrets/cookies/{hostname}.txt`，或配置 `YTDLP_COOKIES_FILE` / `YTDLP_AUTH_BEARER`。
- Path B 的 `sourceUrl` 可能是详情页而非直链；播不了时在 admin 补链或改走 Path A
- 仅用有权测试的源站
