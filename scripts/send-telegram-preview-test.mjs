const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
const siteUrl = (process.env.TELEGRAM_PREVIEW_SITE_URL || "https://velvetmovie.space").trim();
const shortCode = (process.env.TELEGRAM_PREVIEW_CODE || "a7K3").trim();

if (!token || !chatId) {
  console.error(
    "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. Set them in the current shell before running this script.",
  );
  process.exit(1);
}

let previewUrl;
try {
  previewUrl = new URL(`/p/${encodeURIComponent(shortCode)}`, siteUrl);
} catch {
  console.error("TELEGRAM_PREVIEW_SITE_URL must be a valid absolute URL.");
  process.exit(1);
}

if (previewUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(previewUrl.hostname)) {
  console.error("Telegram must be able to crawl a public HTTPS TELEGRAM_PREVIEW_SITE_URL.");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{1,32}$/.test(shortCode)) {
  console.error("TELEGRAM_PREVIEW_CODE must contain only letters, digits, underscores, or hyphens.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    // Bot API requires at least one character. U+2063 keeps the message body visually empty.
    text: "\u2063",
    link_preview_options: {
      url: previewUrl.toString(),
      prefer_large_media: true,
      show_above_text: true,
    },
  }),
});

const result = await response.json().catch(() => null);
if (!response.ok || !result?.ok) {
  console.error(`Telegram sendMessage failed (${response.status}): ${result?.description || "unknown error"}`);
  process.exit(1);
}

console.log(`Telegram preview sent: chat=${chatId} message=${result.result.message_id}`);
console.log(`Preview URL: ${previewUrl.toString()}`);
