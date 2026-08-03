/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@velvet/ui", "@velvet/api-client", "@velvet/validators"],
  trailingSlash: false,
  async rewrites() {
    const apiTarget = (process.env.API_PROXY_TARGET || "http://127.0.0.1:4000").replace(/\/$/, "");
    return [
      { source: "/favicon.ico", destination: "/favicon.svg" },
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
    ];
  },
};

export default nextConfig;
