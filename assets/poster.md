# Velvet 封面海报文案

> 用于 README 顶部、社交媒体（X/微博/掘金/B站动态）、博客头图等场景。

## 一、6 句话精简版（README 摘要 / 推文）

> 一个面向越南市场的**短剧独立站**开源脚手架：观众可看，创作者可上传分成，平台可抽佣。
> 双语（越南语 + 中文）Day 1，签名播放、幂等 Webhook、对账骨架均已内置。
> **不包含任何真实支付实现**——支付只留抽象，由你接入 alipay / wechat / stripe / momo ……
> 单仓单域名路径分区：`/` 观众 · `/creator` 创作者 · `/admin` 管理后台。
> 技术栈：**Next.js 16 + NestJS 11 + Prisma 6 + PostgreSQL 16 + HLS + FFmpeg**。
> MIT 开箱即用，二次开发、商业部署都欢迎。

---

## 二、20 字短标题（社交媒体主图 / Banner）

```
Velvet · 越南短剧独立站开源版
```

副标题（任选其一）：

- `Web-first · 双语 Day 1 · 支付抽象 · MIT 开源`
- `Vietnam Short-Drama Platform · Open Source`
- `观众 / 创作者 / 平台三端一体，开箱即用`

---

## 三、长图文版（公众号 / 博客 / GitHub Releases）

### 标题
**Velvet · 一个能直接跑起来的越南短剧独立站开源脚手架**

### 副标
**MIT 开源 · 双语 Day 1 · 支付抽象可插拔 · 三端一体**

### 正文（三段式，简洁）

**它是什么**

Velvet 是一个面向越南市场的 Web 短剧平台开源脚手架，把「观众看剧 / 创作者上传分成 / 平台审核运营」三件事装进**同一个仓库、同一套单域名路径分区**：
`/` 观众 · `/creator` 创作者 · `/admin` 管理后台。

**它解决了什么问题**

- 视频片源**绝不外泄**：HLS 短时签名 URL，链接过期即失效
- 支付回调**绝不重复加款**：Webhook 幂等 + `eventId` 去重 + 钱包乐观锁
- 多币种账本**永远对得上**：订单保存实付币种 + 汇率快照，账本只认 VND
- **双语 Day 1**：vi 默认 + zh 切换，i18n key 与 slug 双绑
- 创作者分账**开箱即用**：默认 70% / 30%，T+7 解冻与提现审核

**它刻意没包含什么**

任何真实支付渠道的实现细节（私钥、签名、SDK 调用）一律不进入仓库——只保留 `PaymentProvider` 抽象接口、对账骨架与模拟支付。商业部署时按你的地区合规接入 alipay / wechat / stripe / momo / zalopay / vietqr 即可。

**技术栈**

- Web：**Next.js 16** + React 19 + Tailwind v4 + hls.js
- API：**NestJS 11** + Prisma 6 + PostgreSQL 16
- 媒体：TUS 断点续传 + FFmpeg（480p / 720p HLS）

**License：** MIT

**仓库：** https://github.com/opc007/velvet-platform

---

## 四、设计取舍（README「设计哲学」章节可用）

- **地基优先于花活**：支付抽象 / 幂等 / 对账 / 签名播放 / 双语必须 Day 1 落地，礼物打赏、整剧打包、PWA 等延后
- **账本只认 VND**：避免多币种浮点累计误差，所有展示币种都从 VND 折算
- **写钱必走事务 + 乐观锁**：`Wallet.version` 自旋重试，杜绝并发超扣
- **三端同源不同角色**：避免子域名拆端带来的鉴权 / 跨域 / Cookie 复杂度
- **官方脚手架自建**：不依赖任何冷门模板，整套可读、可改、可裁

---

## 五、可选 Emoji Tag（用于社交平台分类）

`#开源` `#短剧` `#越南市场` `#NextJS` `#NestJS` `#Prisma` `#支付抽象` `#短视频` `#全栈脚手架`
