/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@velvet/ui", "@velvet/api-client", "@velvet/validators"],
  trailingSlash: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    const apiTarget = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4000").replace(/\/$/, "");
    return [
      { source: "/favicon.ico", destination: "/favicon.svg" },
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
    ];
  },
};

export default nextConfig;
