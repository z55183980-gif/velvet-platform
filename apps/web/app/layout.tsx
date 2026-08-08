import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Inter, Noto_Sans_SC, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { BrandSplash } from "@/components/brand-splash";
import { SiteConfigProvider } from "@/lib/site-config";
import {
  localeFromAcceptLanguage,
  normalizeInterfaceLanguage,
} from "@/lib/languages";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

/** Fail-open: storage / early-script errors must never leave a permanent black overlay. */
const BRAND_SPLASH_BOOT_SCRIPT = `(function(){function hideSplash(){try{document.documentElement.classList.remove("velvet-splash-lock");}catch(e){}var node=document.getElementById("velvet-boot-splash");if(!node)return;node.dataset.skip="1";node.setAttribute("hidden","");node.style.display="none";}try{var el=document.getElementById("velvet-boot-splash");if(!el)return;var KEY="dv_splash_done";var FADE=340;function dismiss(){try{sessionStorage.setItem(KEY,"1");}catch(e){}var node=document.getElementById("velvet-boot-splash");document.documentElement.classList.remove("velvet-splash-lock");if(!node)return;node.style.transition="opacity "+FADE+"ms ease";node.style.opacity="0";node.style.pointerEvents="none";window.setTimeout(function(){node.setAttribute("hidden","");node.style.display="none";},FADE+40);}var seen=false;try{seen=!!sessionStorage.getItem(KEY);}catch(e){hideSplash();return;}if(seen||window.matchMedia("(min-width:768px)").matches){el.dataset.skip="1";el.setAttribute("hidden","");el.style.display="none";document.documentElement.classList.remove("velvet-splash-lock");}else{document.documentElement.classList.add("velvet-splash-lock");window.setTimeout(dismiss,3200);}}catch(e){hideSplash();}})();`;

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
    // Translucent status bar so portrait watch / feed can draw under the notch;
    // controls use env(safe-area-inset-*). Non-immersive tabs pad the same inset.
    statusBarStyle: "black-translucent",
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
  const requestHeaders = await headers();
  const cookieLocale = jar.get("dv_locale")?.value;
  // Cookie wins; otherwise try Accept-Language. Empty/unsupported AL → English for this render.
  // (Middleware leaves cookie unset when AL is empty so the client can still use navigator.)
  const initialLocale = cookieLocale
    ? normalizeInterfaceLanguage(cookieLocale)
    : localeFromAcceptLanguage(requestHeaders.get("accept-language"));
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html
      lang={initialLocale}
      className={`dark ${plusJakarta.variable} ${inter.variable} ${notoSansSC.variable}`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
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
          suppressHydrationWarning
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
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: BRAND_SPLASH_BOOT_SCRIPT }} />
        <ThemeProvider>
          <LocaleProvider initialLocale={initialLocale}>
            <ToastProvider>
              <AuthProvider>
                <SiteConfigProvider>
                  <AppShell>{children}</AppShell>
                  <BrandSplash />
                </SiteConfigProvider>
              </AuthProvider>
            </ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
