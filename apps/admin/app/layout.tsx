import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AdminChrome } from "@/components/admin-chrome";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Ops Velvet",
  description: "Velvet operations console",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.png", sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Opt into request-time rendering so proxy CSP nonce is stamped on Next bootstrap
  // scripts. Static prerender left scripts without nonce while CSP required one →
  // hydration never ran and AdminShell stayed on "加载中…".
  await headers();

  return (
    <html lang="zh" data-theme="light" className={inter.variable} suppressHydrationWarning>
      <body>
        <Providers>
          <AdminChrome>{children}</AdminChrome>
        </Providers>
      </body>
    </html>
  );
}
