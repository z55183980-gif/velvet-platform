import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AdminChrome } from "@/components/admin-chrome";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" data-theme="light" suppressHydrationWarning>
      <body>
        <Providers>
          <AdminChrome>{children}</AdminChrome>
        </Providers>
      </body>
    </html>
  );
}
