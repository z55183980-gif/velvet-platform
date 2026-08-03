import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/toast";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Velvet — Spicy Short Dramas",
  description: "Forbidden romance. Private affairs. Unlock every episode.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('dv_theme')||'dark';var r=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;var d=document.documentElement;d.dataset.theme=r;d.classList.add(r);d.classList.remove(r==='light'?'dark':'light');d.style.colorScheme=r;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>
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
