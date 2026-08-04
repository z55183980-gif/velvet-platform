import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { normalizeInterfaceLanguage } from "@/lib/languages";

export const metadata: Metadata = {
  title: "Velvet — Spicy Short Dramas",
  description: "Forbidden romance. Private affairs. Unlock every episode.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.png", sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS "Add to Home Screen": fullscreen app chrome (no Safari toolbar).
  appleWebApp: {
    capable: true,
    title: "Velvet",
    // Opaque bar — content starts below status bar; bottom home-indicator
    // insets still apply once viewportFit is cover.
    statusBarStyle: "black",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

/**
 * Lock pinch/double-tap zoom on mobile (short-video feed).
 * viewportFit cover is required so env(safe-area-inset-*) is non-zero
 * in standalone / notch devices (home indicator clearance for bottom nav).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0D12" },
    { media: "(prefers-color-scheme: light)", color: "#0B0D12" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const initialLocale = normalizeInterfaceLanguage(jar.get("dv_locale")?.value);

  return (
    <html lang={initialLocale} className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('dv_theme');var r=(t==='light'||t==='dark')?t:'dark';var d=document.documentElement;d.dataset.theme=r;d.classList.add(r);d.classList.remove(r==='light'?'dark':'light');d.style.colorScheme=r;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider initialLocale={initialLocale}>
            <ToastProvider>
              <AuthProvider>
                <AppShell>{children}</AppShell>
              </AuthProvider>
            </ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
