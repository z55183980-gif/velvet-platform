# 同步到 GitHub 的标准流程

> 本文档是 `opc007/dramavn-platform` 的专用同步手册。  
> 目标：**任何人/任何机器凭这一份文档就能把本地代码推到 GitHub**，不依赖记忆。

---

## 0. 仓库信息（先记牢）

| 项 | 值 |
|---|---|
| 远程仓库 | `https://github.com/opc007/dramavn-platform` |
| 默认分支 | `main` |
| 远程名 | `origin` |
| 协议 | HTTPS（用 GitHub CLI 登录态） |
| 所有者 | `opc007` |
| 可见性 | Public |
| License | MIT |

仓库地址（任选其一）：

```
https://github.com/opc007/dramavn-platform.git
git@github.com:opc007/dramavn-platform.git
```

---

## 1. 一次性环境准备（只做一次）

### 1.1 安装 GitHub CLI（如尚未安装）

```bash
brew install gh
```

### 1.2 登录 GitHub（只需要做一次）

**方式 A：浏览器（推荐，最省事）**

```bash
gh auth login -h github.com --web --scopes repo
```

按提示点开浏览器、授权 `repo` 权限即可。

**方式 B：手动 PAT（无浏览器时）**

1. 打开 https://github.com/settings/tokens/new
2. Note 随便填，比如 `dramavn-sync`
3. 勾选 `repo`（其它不勾）
4. 生成后复制 `ghp_xxx...`
5. 回到终端：

```bash
echo "ghp_你的token" | gh auth login --with-token
```

验证登录态：

```bash
gh auth status
# 应该看到 ✓ Logged in to github.com account opc007 (keyring)
#         Token scopes: 'repo', ...
```

### 1.3 设置 git 用户身份（首次推送必须）

```bash
cd /path/to/短剧独立站平台
git config user.name  "opc007"
git config user.email "opc007@users.noreply.github.com"
```

> 如果只想在这一个仓库生效（推荐，**不会污染全局**），省略 `--global`。

### 1.4 确认 remote 已配置（首次推送后自动生成）

```bash
git remote -v
# 应该看到
# origin  https://github.com/opc007/dramavn-platform.git (fetch)
# origin  https://github.com/opc007/dramavn-platform.git (push)
```

如果 remote 不存在，重新加上：

```bash
git remote add origin https://github.com/opc007/dramavn-platform.git
git branch --set-upstream-to=origin/main main
```

---

## 2. 日常同步（修改后一键推送）

最常用的「一气呵成」命令：

```bash
cd /path/to/短剧独立站平台
git add -A
git commit -m "简短描述本次改动"
git push origin main
```

也可以合成一行：

```bash
git add -A && git commit -m "feat: xxx" && git push origin main
```

### 2.1 推送前必查清单（避免把敏感信息同步上去）

- [ ] `.env` **没被** `git add`（已在 `.gitignore`）
- [ ] 没有新增 `*.pem / *.key / *.crt / *.p12`
- [ ] 没有把 `node_modules / .next / storage / .workbuddy` 加进去
- [ ] 支付相关改动只动 `PaymentProvider` 抽象，**没有还原 alipay-sdk**

快速体检：

```bash
git status
git diff --cached --stat | head -20
# 看到文件大小异常（>5MB）或后缀是 .key/.pem 立刻取消 add
```

---

## 3. 第一次同步（一次性，新机器）

如果换了一台机器，要把这台机器的代码**首次**推到 GitHub：

### 3.1 已有 remote，从零开始

```bash
cd /path/to/短剧独立站平台
git init -b main
git remote add origin https://github.com/opc007/dramavn-platform.git
git add -A
git commit -m "Initial open-source release"
git push -u origin main
```

### 3.2 用 gh CLI 一行搞定（推荐）

前提：本机已 `gh auth login` 且当前目录就是项目根。

```bash
cd /path/to/短剧独立站平台
gh repo create dramavn-platform \
  --public \
  --description "Vietnam short-drama platform: web-first, vi+zh day-1, signature playback, idempotent webhooks, pluggable PaymentProvider. MIT." \
  --source=. \
  --remote=origin \
  --push
```

---

## 4. 紧急回滚（万一推错了）

### 4.1 撤销最后一次 commit（保留改动）

```bash
git reset --soft HEAD~1
```

### 4.2 撤销最后一次 commit（**丢弃改动，慎用**）

```bash
git reset --hard HEAD~1
```

### 4.3 强制覆盖远程（**慎之又慎**，会让别人丢失 commit）

```bash
git push --force origin main
```

---

## 5. 常见错误速查

| 现象 | 原因 | 解决 |
|---|---|---|
| `Permission denied (publickey)` | 当前机器没有 GitHub SSH key | 改用 HTTPS + `gh auth login`（本文档走的就是这条路） |
| `support for password authentication was removed` | 用 HTTPS + 账号密码推送 | 改用 PAT 或 `gh auth login` |
| `Token scopes: 'gist', read:org'` 没有 `repo` | 旧 token 没 repo 权限 | `gh auth refresh -h github.com -s repo` |
| `failed to push some refs` | 远程有本地没有的 commit | 先 `git pull --rebase origin main` 再 push |
| 误把 `.env` 推上去 | 没看清单 | 立刻 `git rm --cached .env` → commit → push，并去 GitHub Settings → Developer settings → PAT **撤销/轮换**该 token |

---

## 6. 不要同步的黑名单（人工把关）

以下内容**绝对不能**进 `opc007/dramavn-platform`：

- 🔒 任何支付渠道的私钥、AppID、商户号、API Key、证书（`*.pem`/`*.key`/`*.crt`/`*.p12`）
- 🔒 真实 `.env` / `.env.production` / `.env.local`
- 🔒 SMTP / SMS 网关的用户名、授权码
- 🔒 数据库连接字符串（含真实账号密码）
- 🔒 `storage/` 本地演示片与转码产物
- 🔒 个人身份信息（手机号、身份证、CCCD 扫描件）

`alipay.provider.ts` 等具体支付实现**也保持精简**——只留抽象占位，真实 SDK 由部署方在自己的私有分支 / 私有仓库接入。

---

## 7. 一句话总结

```bash
# 登录一次（只做一次）→ 之后随便推
gh auth login -h github.com --web --scopes repo
git add -A && git commit -m "msg" && git push origin main
```
