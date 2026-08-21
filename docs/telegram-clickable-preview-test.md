# Telegram 可点击封面测试

测试入口：`https://velvetmovie.space/p/a7K3`。

短码 `a7K3` 映射到线上剧集 `betraying-my-billionaire-husband` 的第 1 集。
原始调试入口仍是：`https://velvetmovie.space/tg-preview/test?drama=<剧集 slug>&ep=<集数>`。

- Telegram 抓取入口页的 Open Graph 图片，显示大图网页预览。
- 消息正文只包含不可见字符，不显示原始链接。
- 用户点击预览卡片后，浏览器跳到 `/drama/<slug>/play?ep=<集数>`。

## 发送测试消息

先部署 Web，让 Telegram 能从公网 HTTPS 读取入口页和图片，然后在 PowerShell 当前会话设置：

```powershell
$env:TELEGRAM_BOT_TOKEN = "BotFather 返回的 token"
$env:TELEGRAM_CHAT_ID = "目标用户、群组或 @频道用户名"
$env:TELEGRAM_PREVIEW_SITE_URL = "https://velvetmovie.space"
$env:TELEGRAM_PREVIEW_CODE = "a7K3"
pnpm telegram:preview:test
```

不要把 Bot token 写入仓库或提交到 Git。Bot 向频道发送时必须是该频道管理员。

Telegram 会缓存网页预览。重复测试同一剧集封面时，可以临时改变 URL 参数，或等待缓存刷新。
