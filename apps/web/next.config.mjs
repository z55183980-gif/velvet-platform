/** @type {import('next').NextConfig} */
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
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
    const apiTarget = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4100").replace(
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
