import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { BrandSplash } from "@/components/brand-splash";
import { normalizeInterfaceLanguage } from "@/lib/languages";

const BRAND_SPLASH_BOOT_SCRIPT = `(function(){try{var el=document.getElementById("velvet-boot-splash");if(!el)return;var KEY="dv_splash_done";var FADE=340;function dismiss(){try{sessionStorage.setItem(KEY,"1");}catch(e){}var node=document.getElementById("velvet-boot-splash");document.documentElement.classList.remove("velvet-splash-lock");if(!node)return;node.style.transition="opacity "+FADE+"ms ease";node.style.opacity="0";node.style.pointerEvents="none";window.setTimeout(function(){try{node.remove();}catch(e){}},FADE+40);}if(sessionStorage.getItem(KEY)||window.matchMedia("(min-width:768px)").matches){el.dataset.skip="1";el.setAttribute("hidden","");el.style.display="none";document.documentElement.classList.remove("velvet-splash-lock");}else{document.documentElement.classList.add("velvet-splash-lock");window.setTimeout(dismiss,3200);}}catch(e){try{document.documentElement.classList.remove("velvet-splash-lock");}catch(_){}}})();`;

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
        {/* Mobile session boot splash (TikTok-style). Hidden on md+ / already-seen sessions. */}
        <div
          id="velvet-boot-splash"
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black md:hidden"
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- first-paint splash, no next/image */}
          <img
            src="/logo.png"
            alt=""
            width={88}
            height={88}
            decoding="async"
            className="h-[88px] w-[88px] object-contain"
          />
          <span className="mt-5 text-[28px] font-bold tracking-tight text-white">Velvet</span>
          <span className="absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-[12px] font-medium tracking-wide text-white/35">
            Short dramas. Private thrills.
          </span>
        </div>
        <script dangerouslySetInnerHTML={{ __html: BRAND_SPLASH_BOOT_SCRIPT }} />
        <ThemeProvider>
          <LocaleProvider initialLocale={initialLocale}>
            <ToastProvider>
              <AuthProvider>
                <AppShell>{children}</AppShell>
                <BrandSplash />
              </AuthProvider>
            </ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
