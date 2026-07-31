# 03 · 数据库 Schema 与 API 文档（v7.0）

> 版本：v7.0 | 2026-07-29  
> **若与 [00-地基复盘与修正.md](./00-地基复盘与修正.md) 冲突，以 00 为准。**  
> **v7 已落地（以 §三 为准）**：订单多币种快照、`idempotencyKey`、`wallets.version`、流水 `@@unique([orderId,type])`、WatchHistory `@@unique([userId,episodeId])`、`Category`/`SystemSetting`/`Banner`/`PaymentReconciliation` 均已写入 §三；`banners` 已确认为 MVP 必做。

---

## 〇、相对 v6 的 Schema 修正（以下字段已在 §三 落地，以 §三 为准）

```prisma
// Order 增加（多币种可审计）
amountVnd        BigInt
payCurrency      String            // VND | CNY | USD
payAmount        Decimal?          @db.Decimal(18, 2)
fxRate           Decimal?          @db.Decimal(18, 8)
fxSource         String?
idempotencyKey   String            @unique

// Wallet 增加乐观锁
version          Int               @default(0)

// WalletTransaction 防重复入账
@@unique([orderId, type])

// WatchHistory 防爆炸
@@unique([userId, episodeId])

// 新增
model SystemSetting { key String @id; value Json; updatedAt DateTime @updatedAt }
model Banner { /* 运营 Banner，轻量表，保留 */ }
model PaymentReconciliation { /* 日对账结果 */ }
```

上述字段均已写入 §三 的 Prisma Schema；完整定义见 [00 §四](./00-地基复盘与修正.md)。

---

## 一、数据库概览（MVP 精简版）

| 项目 | 值 |
|---|---|
| **DBMS** | PostgreSQL 16 |
| **字符集** | UTF8 |
| **排序规则** | `vi_VN` + `zh_CN`（ICU）|
| **扩展** | `unaccent`、`pg_trgm`、`pg_stat_statements` |
| **时区** | 存 UTC，展示 `Asia/Ho_Chi_Minh` |
| **金额类型** | `BIGINT` 存 đồng |
| **核心表数** | **17 张**（14 业务表 + SystemSetting / Banner / PaymentReconciliation 3 张地基表）|

> MVP 阶段不做的表：`gifts`、`studio_members`、复杂 `audit_logs`（可用应用日志兜底）。  
> **必须有**：`system_settings`、`banners`、`payment_reconciliations`（见文首 v7 修正）。

### 1.1 初始化 SQL

```sql
-- infra/postgres/init.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- 越南语 collation
CREATE COLLATION vi_vn (provider = icu, locale = 'vi-VN', deterministic = false);
```

---

## 二、ER 关系图（核心业务表）

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    users     │ 1───1 │   creators   │ 1───* │    dramas    │
└──────────────┘       └──────────────┘       └──────────────┘
       │ 1                       │ 1                  │ 1
       │                         │                    │
       │ *                       │ *                  │ *
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   wallets    │       │   earnings   │       │  episodes    │
└──────────────┘       └──────────────┘       └──────────────┘
       │ 1                                          │ *
       │ *                                          │
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ wallet_txns  │       │    orders    │ 1───* │ user_unlocks │
└──────────────┘       └──────────────┘       └──────────────┘
                                │
                                │ *
                         ┌──────────────┐
                         │  withdraws   │
                         └──────────────┘

另：favorites / watch_history / sessions / system_settings / banners / payment_reconciliations
```

---

## 三、Prisma Schema（业务核心 + v7 地基字段）

> 完整 schema 存于 `packages/database/prisma/schema.prisma`。

### 3.1 用户与创作者

```prisma
// ========== 用户 ==========
model User {
  id            BigInt      @id @default(autoincrement())
  uuid          String      @unique @default(uuid())
  phone         String?     @unique
  email         String?     @unique
  zaloId        String?     @unique
  googleId      String?     @unique
  nickname      String?
  avatarUrl     String?
  locale        String      @default("vi")     // vi | zh
  status        UserStatus  @default(ACTIVE)
  createdAt     DateTime    @default(now()) @db.Timestamptz
  updatedAt     DateTime    @updatedAt
  deletedAt     DateTime?

  wallet        Wallet?
  creator       Creator?
  orders        Order[]
  unlocks       UserUnlock[]
  favorites     Favorite[]
  watchHistory  WatchHistory[]
  sessions      Session[]

  @@index([phone])
  @@index([zaloId])
  @@index([createdAt])                       // 用于后台按时间筛选
  @@map("users")
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  BANNED
}

// ========== 创作者（含官方）==========
model Creator {
  id              BigInt      @id @default(autoincrement())
  userId          BigInt      @unique
  creatorType     CreatorType @default(INDIVIDUAL)
  displayName     String

  // KYC
  kycStatus       KycStatus   @default(PENDING)
  cccdNumber      String?
  cccdFrontUrl    String?
  cccdBackUrl     String?
  faceVerified    Boolean     @default(false)
  taxCode         String?

  // 银行卡
  bankAccount     Json?       // { bankBin, accountNo, accountName }
  bankVerified    Boolean     @default(false)

  // 分润
  revenueShare    Decimal     @default(0.70) @db.Decimal(5, 4)

  status          CreatorStatus @default(ACTIVE)
  createdAt       DateTime    @default(now()) @db.Timestamptz
  updatedAt       DateTime    @updatedAt

  user            User        @relation(fields: [userId], references: [id])
  dramas          Drama[]
  orders          Order[]
  earnings        CreatorEarning?
  withdraws       WithdrawRequest[]

  @@index([creatorType])
  @@index([kycStatus])
  @@map("creators")
}

enum CreatorType {
  OFFICIAL         // 官方自制（revenueShare = 1.0）
  INDIVIDUAL       // 个人创作者（revenueShare = 0.70）
  // MVP 不做：STUDIO, PARTNER
}

enum KycStatus {
  PENDING
  APPROVED
  REJECTED
}

enum CreatorStatus {
  ACTIVE
  SUSPENDED
  BANNED
}

// ========== Session ==========
model Session {
  id            String      @id
  userId        BigInt
  expiresAt     DateTime
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime    @default(now())

  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])                       // 清理过期 session
  @@map("sessions")
}
```

### 3.2 短剧与剧集

```prisma
// ========== 分类（主数据，F9：slug + 双语名）==========
model Category {
  slug        String   @id                            // 'do_thi' | 'ngon_tinh' | ...
  nameVi      String
  nameZh      String
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now()) @db.Timestamptz

  dramas      Drama[]
  @@index([isActive, sortOrder])
  @@map("categories")
}

// ========== 短剧 ==========
model Drama {
  id              BigInt      @id @default(autoincrement())
  uuid            String      @unique @default(uuid())
  creatorId       BigInt

  // 双语标题（越南语 + 中文，见 00 F8）
  titleVi         String
  titleZh         String?
  descriptionVi   String?
  descriptionZh   String?

  categorySlug    String                          // = Category.slug（冗余存储，便于查询）
  category        Category  @relation(fields: [categorySlug], references: [slug])
  tags            String[]                        // PostgreSQL 数组

  coverUrl        String?

  totalEpisodes   Int         @default(0)
  freeEpisodeCount Int        @default(3)         // 默认前 3 集免费（系统可配，见 SystemSetting）
  // 免费判定优先级（播放/解锁前校验，见 00 F6）：
  //   1) episode.isFree == true            → 免费
  //   2) episodeNumber <= freeEpisodeCount → 免费
  //   否则为付费集

  // 统计
  viewCount       BigInt      @default(0)
  unlockCount     BigInt      @default(0)
  favoriteCount   BigInt      @default(0)

  // 状态
  status          DramaStatus @default(DRAFT)
  isOfficial      Boolean     @default(false)
  isFeatured      Boolean     @default(false)

  createdAt       DateTime    @default(now()) @db.Timestamptz
  updatedAt       DateTime    @updatedAt
  publishedAt     DateTime?

  creator         Creator     @relation(fields: [creatorId], references: [id])
  episodes        Episode[]
  favorites       Favorite[]

  // 索引：核心查询场景全覆盖
  @@index([status, publishedAt(sort: Desc)])   // 首页最新
  @@index([categorySlug, status])              // 分类筛选
  @@index([creatorId])
  @@index([isOfficial, isFeatured, status])    // 首页推荐
  // GIN 索引用于越南语模糊搜索
  // CREATE INDEX dramas_title_vi_trgm ON dramas USING gin (title_vi gin_trgm_ops);
  @@map("dramas")
}

enum DramaStatus {
  DRAFT
  PENDING_REVIEW
  LIVE
  OFFLINE
  REJECTED
}

// ========== 剧集 ==========
model Episode {
  id              BigInt      @id @default(autoincrement())
  uuid            String      @unique @default(uuid())
  dramaId         BigInt
  episodeNumber   Int

  title           String?

  // 媒体（MVP Day1）
  hlsUrl          String?                         // CDN 加速后的 .m3u8
  thumbnailUrl    String?
  durationSec     Int         @default(0)

  // 业务
  isFree          Boolean     @default(false)
  priceVnd        BigInt      @default(0)        // 越南盾

  // 转码状态
  uploadStatus    UploadStatus @default(PENDING)
  transcodeStatus TranscodeStatus @default(PENDING)
  originalUrl     String?

  // 统计
  viewCount       BigInt      @default(0)
  unlockCount     BigInt      @default(0)

  createdAt       DateTime    @default(now()) @db.Timestamptz
  updatedAt       DateTime    @updatedAt

  drama           Drama       @relation(fields: [dramaId], references: [id], onDelete: Cascade)
  unlocks         UserUnlock[]

  @@unique([dramaId, episodeNumber])
  @@index([dramaId, episodeNumber])
  @@index([transcodeStatus])                    // worker 扫表
  @@map("episodes")
}

enum UploadStatus {
  PENDING
  UPLOADING
  COMPLETED
  FAILED
}

enum TranscodeStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

// ========== 用户解锁记录 ==========
model UserUnlock {
  id            BigInt      @id @default(autoincrement())
  userId        BigInt
  episodeId     BigInt
  orderId       BigInt
  unlockedAt    DateTime    @default(now()) @db.Timestamptz

  user          User        @relation(fields: [userId], references: [id])
  episode       Episode     @relation(fields: [episodeId], references: [id])
  order         Order       @relation(fields: [orderId], references: [id])

  @@unique([userId, episodeId])                 // 防重复解锁
  @@index([userId, unlockedAt(sort: Desc)])     // 个人中心历史
  @@map("user_unlocks")
}

// ========== 收藏 ==========
model Favorite {
  id            BigInt      @id @default(autoincrement())
  userId        BigInt
  dramaId       BigInt
  createdAt     DateTime    @default(now()) @db.Timestamptz

  user          User        @relation(fields: [userId], references: [id])
  drama         Drama       @relation(fields: [dramaId], references: [id])

  @@unique([userId, dramaId])
  @@index([userId, createdAt(sort: Desc)])
  @@map("favorites")
}

// ========== 观看历史 ==========
model WatchHistory {
  id            BigInt      @id @default(autoincrement())
  userId        BigInt
  episodeId     BigInt
  dramaId       BigInt                              // 冗余字段，方便查询
  progressSec   Int         @default(0)
  watchedAt     DateTime    @default(now()) @db.Timestamptz

  user          User        @relation(fields: [userId], references: [id])

  @@unique([userId, episodeId])                     // 【v7】进度 upsert，禁止每次 insert
  @@index([userId, watchedAt(sort: Desc)])
  @@map("watch_history")
}
```

### 3.3 钱包与订单

```prisma
// ========== 用户钱包 ==========
model Wallet {
  userId          BigInt      @id
  balanceVnd      BigInt      @default(0)
  totalRecharged  BigInt      @default(0)
  totalSpent      BigInt      @default(0)
  version         Int         @default(0)           // 【v7】乐观锁
  updatedAt       DateTime    @updatedAt

  user            User        @relation(fields: [userId], references: [id])
  transactions    WalletTransaction[]

  @@map("wallets")
}

// ========== 钱包流水（观众消费钱包，复式记账）==========
model WalletTransaction {
  id              BigInt      @id @default(autoincrement())
  walletUserId    BigInt
  type            TxType
  amountVnd       BigInt                              // 正负数
  orderId         BigInt                              // 关联订单（必填，用于幂等）
  balanceAfter    BigInt                              // 记账后余额
  remark          String?
  createdAt       DateTime    @default(now()) @db.Timestamptz

  wallet          Wallet      @relation(fields: [walletUserId], references: [userId])

  @@unique([orderId, type])                         // 【v7】防重复入账
  @@index([walletUserId, createdAt(sort: Desc)])
  @@map("wallet_transactions")
}

// 观众消费钱包流水类型（创作者收益另记 CreatorEarning，不在此表）
enum TxType {
  TOPUP                  // 充值入账
  UNLOCK                 // 单集解锁扣款
  REFUND                 // 退款
}

// ========== 订单 ==========
model Order {
  id              BigInt      @id @default(autoincrement())
  orderNo         String      @unique
  idempotencyKey  String      @unique               // 【v7】创建幂等
  userId          BigInt
  creatorId       BigInt?

  orderType       OrderType
  episodeId       BigInt?
  dramaId         BigInt?

  // 账本本位 VND（充值=到账额；解锁=消费额；等价于 00 的 amountVnd）
  amountVnd         BigInt
  creatorIncomeVnd  BigInt                          // 创作者实得（70%）
  platformFeeVnd    BigInt                          // 平台抽成（30%）

  // 【v7】多币种可审计快照
  payCurrency       String                          // VND | CNY | USD
  payAmount         Decimal?  @db.Decimal(18, 2)    // 渠道实付
  fxRate            Decimal?  @db.Decimal(18, 8)
  fxSource          String?                         // manual | stripe | config

  paymentMethod    PaymentMethod
  paymentStatus    PaymentStatus @default(PENDING)
  externalRef      String?
  paidAt           DateTime?
  refundedAt       DateTime?

  createdAt       DateTime    @default(now()) @db.Timestamptz
  updatedAt       DateTime    @updatedAt

  user            User        @relation(fields: [userId], references: [id])
  creator         Creator?    @relation(fields: [creatorId], references: [id])
  unlocks         UserUnlock[]

  @@index([userId, createdAt(sort: Desc)])
  @@index([creatorId, createdAt(sort: Desc)])
  @@index([paymentStatus, createdAt])
  @@map("orders")
}

enum OrderType {
  TOPUP
  EPISODE_UNLOCK
}

enum PaymentMethod {
  WALLET
  STRIPE
  WECHAT
  ALIPAY
  MOMO
  ZALOPAY
  VIETQR
  BANK_TRANSFER
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
  CANCELLED
}
```

### 3.4 创作者收益与提现

```prisma
// ========== 创作者收益余额 ==========
model CreatorEarning {
  creatorId        BigInt      @id
  availableVnd     BigInt      @default(0)          // 可提现
  pendingVnd       BigInt      @default(0)          // T+7 待解冻
  withdrawnVnd     BigInt      @default(0)
  totalEarnedVnd   BigInt      @default(0)
  updatedAt        DateTime    @updatedAt

  creator          Creator     @relation(fields: [creatorId], references: [id])

  @@map("creator_earnings")
}

// ========== 提现申请 ==========
model WithdrawRequest {
  id              BigInt      @id @default(autoincrement())
  requestNo       String      @unique
  creatorId       BigInt
  amountVnd       BigInt
  bankInfo        Json                              // 当时快照
  status          WithdrawStatus @default(PENDING)
  rejectReason    String?
  paidAt          DateTime?
  createdAt       DateTime    @default(now()) @db.Timestamptz
  updatedAt       DateTime    @updatedAt

  creator         Creator     @relation(fields: [creatorId], references: [id])

  @@index([creatorId, createdAt(sort: Desc)])
  @@index([status, createdAt])                      // 后台审核队列
  @@map("withdraw_requests")
}

enum WithdrawStatus {
  PENDING
  APPROVED
  PAID
  REJECTED
  CANCELLED
}
```

### 3.5 配置 / Banner / 对账（v7 地基表）

```prisma
model SystemSetting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
  @@map("system_settings")
}

model Banner {
  id        BigInt   @id @default(autoincrement())
  titleVi   String
  titleZh   String?
  imageUrl  String
  linkUrl   String?
  dramaId   BigInt?
  startAt   DateTime
  endAt     DateTime
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  @@index([isActive, startAt, endAt])
  @@map("banners")
}

model PaymentReconciliation {
  id            BigInt   @id @default(autoincrement())
  date          DateTime @db.Date
  provider      String
  localPaidCnt  Int
  remotePaidCnt Int
  diffJson      Json?
  status        String   // matched | mismatch
  createdAt     DateTime @default(now())
  @@unique([date, provider])
  @@map("payment_reconciliations")
}
```

---

## 四、数据库初始化脚本（indexes.sql）

```sql
-- 在迁移后运行（Prisma 不支持的部分索引）

-- 越南语模糊搜索（GIN 索引）
CREATE INDEX IF NOT EXISTS dramas_title_vi_trgm
  ON dramas USING gin (title_vi gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dramas_title_zh_trgm
  ON dramas USING gin (title_zh gin_trgm_ops);

-- 创作者搜索
CREATE INDEX IF NOT EXISTS creators_display_name_trgm
  ON creators USING gin (display_name gin_trgm_ops);

-- 钱包流水（按时间倒序）
CREATE INDEX IF NOT EXISTS wallet_txns_user_created
  ON wallet_transactions (wallet_user_id, created_at DESC);

-- 待处理提现（后台查询）
CREATE INDEX IF NOT EXISTS withdraws_status_created
  ON withdraw_requests (status, created_at)
  WHERE status IN ('PENDING', 'APPROVED');
```

---

## 五、API 接口规范

### 5.1 通用规范

- **基础路径**：`/api/v1`
- **响应格式**：`{ code: 0, message: 'ok', data: {...} }`
- **错误处理**：业务错误用 `code != 0`，HTTP 状态码配合
- **鉴权**：除公开接口外，需 session cookie（httpOnly）
- **金额序列化**：所有 VND 字段为 `BigInt`，NestJS 响应须转成字符串（加全局 BigInt 拦截器），避免前端精度丢失（见 00 §八）

### 5.2 鉴权接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/phone-number/send-otp` | 公开 | 发 OTP |
| POST | `/api/auth/phone-number/verify` | 公开 | OTP 登录 |
| POST | `/api/auth/sign-out` | 是 | 登出 |
| GET  | `/api/auth/session` | 是 | 当前会话 |

### 5.3 观众端接口

#### 短剧浏览
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/dramas` | 列表（分类/搜索/分页）|
| GET | `/api/v1/dramas/:id` | 详情（双语）|
| GET | `/api/v1/dramas/:id/episodes` | 剧集列表（含解锁状态）|
| GET | `/api/v1/dramas/featured` | 首页推荐 |
| GET | `/api/v1/categories` | 分类列表 |

#### 播放
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/episodes/:id/play` | 获取签名播放 URL |
| POST | `/api/v1/episodes/:id/progress` | 上报进度 |

#### 钱包与订单
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/wallet` | 钱包余额 |
| GET | `/api/v1/wallet/transactions` | 钱包流水 |
| POST | `/api/v1/orders/topup` | 创建充值订单 |
| GET | `/api/v1/payment-methods` | 获取可用支付渠道（根据区域）|
| POST | `/api/v1/orders/unlock-episode` | 解锁单集（钱包扣款，事务）|
| POST | `/api/v1/orders/:orderNo/refund` | 申请退款（未消费充值原路退 / 系统故障人工退）|
| GET | `/api/v1/orders` | 我的订单 |

#### 个人
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/users/me` | 我的信息 |
| PATCH | `/api/v1/users/me` | 改昵称/头像/语言 |
| GET | `/api/v1/users/me/favorites` | 收藏列表 |
| POST | `/api/v1/users/me/favorites/:dramaId` | 添加收藏 |
| DELETE | `/api/v1/users/me/favorites/:dramaId` | 取消收藏 |
| GET | `/api/v1/users/me/history` | 观看历史 |
| DELETE | `/api/v1/users/me/history` | 清空历史 |

### 5.4 创作者接口

#### KYC
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/creator/kyc/upload-cccd` | 上传 CCCD |
| POST | `/api/v1/creator/kyc/verify-face` | 人脸识别（MVP mock）|
| POST | `/api/v1/creator/kyc/submit` | 提交审核 |
| POST | `/api/v1/creator/bank/bind` | 绑定银行卡 |
| GET | `/api/v1/creator/kyc/status` | 审核状态 |

#### 短剧管理
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/creator/dramas` | 我的短剧 |
| POST | `/api/v1/creator/dramas` | 创建短剧 |
| GET | `/api/v1/creator/dramas/:id` | 详情 |
| PATCH | `/api/v1/creator/dramas/:id` | 编辑 |
| POST | `/api/v1/creator/dramas/:id/submit-review` | 提交审核 |

#### 剧集管理
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/creator/dramas/:id/episodes` | 剧集列表 |
| POST | `/api/v1/creator/dramas/:id/episodes` | 创建剧集 |
| PATCH | `/api/v1/creator/episodes/:id` | 编辑（含定价）|
| DELETE | `/api/v1/creator/episodes/:id` | 删除 |

#### 上传
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/upload/create` | 创建上传任务 |
| PATCH | `/api/v1/upload/:id` | TUS 断点续传 |
| POST | `/api/v1/upload/:id/complete` | 上传完成，触发转码 |

#### 收益与提现
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/creator/dashboard` | 数据看板 |
| GET | `/api/v1/creator/earnings` | 收益明细 |
| GET | `/api/v1/creator/withdraws` | 提现记录 |
| POST | `/api/v1/creator/withdraws` | 申请提现 |

### 5.5 管理后台接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/dramas/pending` | 待审核短剧 |
| POST | `/api/v1/admin/dramas/:id/approve` | 通过 |
| POST | `/api/v1/admin/dramas/:id/reject` | 拒绝 |
| GET | `/api/v1/admin/creators/pending` | 待审核创作者 |
| POST | `/api/v1/admin/creators/:id/kyc/approve` | KYC 通过 |
| GET | `/api/v1/admin/withdraws/pending` | 待处理提现 |
| POST | `/api/v1/admin/withdraws/:id/approve` | 提现通过 |
| POST | `/api/v1/admin/withdraws/:id/reject` | 提现拒绝 |
| GET | `/api/v1/admin/stats/overview` | 全站数据 |
| POST | `/api/v1/admin/orders/:id/mark-paid` | 银行转账人工确认入账（P0 兜底，无 webhook）|
| GET | `/api/v1/admin/reconciliations` | 日对账结果列表 |

### 5.6 Webhook（多渠道支付回调）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/webhooks/stripe` | Stripe 回调 |
| POST | `/api/v1/webhooks/wechat` | 微信回调 |
| POST | `/api/v1/webhooks/alipay` | 支付宝回调 |
| POST | `/api/v1/webhooks/momo` | MoMo 回调（预留）|
| POST | `/api/v1/webhooks/zalopay` | ZaloPay 回调（预留）|
| POST | `/api/v1/webhooks/vietqr` | VietQR 回调（预留）|
> 注：银行转账（bank_transfer）无 webhook，由管理员在后台 `mark-paid` 手动确认入账（见 §5.5）。

---

## 六、关键查询 SQL 示例

### 6.1 首页推荐（热度排序）

```sql
-- 首页混合排序：官方加权 + 热度
SELECT d.*, c.display_name AS creator_name, c.creator_type
FROM dramas d
JOIN creators c ON c.id = d.creator_id
WHERE d.status = 'LIVE'
  AND d.deleted_at IS NULL
ORDER BY
  -- 官方内容加权
  CASE WHEN c.creator_type = 'OFFICIAL' THEN 0 ELSE 1 END,
  -- 综合热度
  d.view_count * 0.3 + d.unlock_count * 0.5 + d.favorite_count * 0.2 DESC,
  d.published_at DESC
LIMIT 20;
```

### 6.2 越南语模糊搜索

```sql
SELECT id, title_vi, title_zh, cover_url
FROM dramas
WHERE status = 'LIVE'
  AND unaccent(title_vi) ILIKE '%' || unaccent($1) || '%'
ORDER BY view_count DESC
LIMIT 20;
```

### 6.3 我的订单

```sql
-- 已使用 (userId, createdAt DESC) 索引
SELECT *
FROM orders
WHERE user_id = $1
  AND payment_status = 'PAID'
ORDER BY created_at DESC
LIMIT 50;
```

### 6.4 创作者本月收益

```sql
SELECT
  COALESCE(SUM(creator_income_vnd), 0) AS month_earning,
  COUNT(*) AS order_count
FROM orders
WHERE creator_id = $1
  AND payment_status = 'PAID'
  AND paid_at >= DATE_TRUNC('month', NOW());
```

### 6.5 全站日数据（管理后台）

```sql
SELECT
  DATE(paid_at) AS date,
  COUNT(*) AS order_count,
  SUM(amount_vnd) AS gmv_vnd,
  SUM(platform_fee_vnd) AS platform_revenue_vnd
FROM orders
WHERE payment_status = 'PAID'
  AND paid_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(paid_at)
ORDER BY date DESC;
```

---

**下一章**：[🚀 04-交付路线图与 Sprint 拆分.md](./04-交付路线图与Sprint拆分.md)