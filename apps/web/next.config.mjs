/** @type {import('next').NextConfig} */
const staticExport = process.env.STATIC_EXPORT === "1";

/** LAN / Tailscale 访问 dev 时放行（否则 /_next/* 被拦，手机端页面空白或路由异常） */
function devOriginsFromEnv() {
  const raw = process.env.ALLOWED_DEV_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        if (s.includes("://")) return new URL(s).host; // host:port
        return s.replace(/^https?:\/\//, "");
      } catch {
        return s;
      }
    });
  return Array.from(
    new Set([
      "192.168.8.194",
      "192.168.8.194:3000",
      "127.0.0.1",
      "127.0.0.1:3000",
      "localhost",
      "localhost:3000",
      ...fromEnv,
    ]),
  );
}

const nextConfig = {
  // Next 16：非 localhost 访问需要显式允许，否则 HMR/部分资源跨域被拒
  allowedDevOrigins: devOriginsFromEnv(),
  ...(staticExport
    ? {
        output: "export",
        distDir: ".next-export",
        // 静态导出可保留尾斜杠；本地/SSR 代理必须关闭，否则 /api/v1/x → /api/v1/x/ 导致 Nest 500
        trailingSlash: true,
      }
    : {
        trailingSlash: false,
      }),
  async rewrites() {
    // 本地 / 非静态导出：同源代理到 NestJS，cookie 鉴权可用
    if (staticExport) return [];
    const apiTarget = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4000").replace(
      /\/$/,
      "",
    );
    return [
      {
        source: "/favicon.ico",
        destination: "/favicon.svg",
      },
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
