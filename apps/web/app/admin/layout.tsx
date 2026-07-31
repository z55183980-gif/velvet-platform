/**
 * Admin route group shell — no consumer Navbar/Footer
 * (stripped by AppShell). Pages still use AdminLayout for sidebar.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell min-h-screen bg-[oklch(0.14_0.008_250)] text-ink antialiased">
      {children}
    </div>
  );
}
