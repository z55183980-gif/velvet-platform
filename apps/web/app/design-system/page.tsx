"use client";

import { useLocale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DramaCard } from "@/components/drama-card";
import { dramas } from "@/lib/mock-data";

const colors = [
  { token: "base", cls: "bg-base" },
  { token: "surface", cls: "bg-surface" },
  { token: "surface-2", cls: "bg-surface-2" },
  { token: "surface-3", cls: "bg-surface-3" },
  { token: "brand", cls: "bg-brand" },
  { token: "brand-strong", cls: "bg-brand-strong" },
  { token: "gold", cls: "bg-gold" },
  { token: "success", cls: "bg-success" },
  { token: "danger", cls: "bg-danger" },
  { token: "line", cls: "bg-line" },
  { token: "ink", cls: "bg-ink" },
  { token: "ink-muted", cls: "bg-ink-muted" },
];

const typeScale = [
  { cls: "text-display", label: "display", px: "56 / 40*" },
  { cls: "text-h1", label: "h1", px: "40 / 32*" },
  { cls: "text-h2", label: "h2", px: "32" },
  { cls: "text-h3", label: "h3", px: "24" },
  { cls: "text-h4", label: "h4", px: "20" },
  { cls: "text-body", label: "body", px: "16" },
  { cls: "text-body-sm", label: "body-sm", px: "14" },
  { cls: "text-caption", label: "caption", px: "12" },
  { cls: "text-overline", label: "overline", px: "12" },
];

const spacing = [4, 8, 16, 24, 40, 64, 96];

export default function DesignSystemPage() {
  const { t } = useLocale();

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6">
      <p className="text-overline uppercase text-brand">{t("ds.subtitle")}</p>
      <h1 className="mt-3 text-h1 font-bold text-ink">{t("ds.title")}</h1>

      <section className="mt-14">
        <h2 className="mb-6 text-h3 font-semibold text-ink">{t("ds.colors")}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {colors.map((c) => (
            <div key={c.token} className="overflow-hidden rounded-lg border border-line">
              <div className={`h-20 w-full ${c.cls}`} />
              <p className="bg-surface px-3 py-2 text-caption text-ink-muted">{c.token}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="mb-6 text-h3 font-semibold text-ink">{t("ds.typeScale")}</h2>
        <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6">
          {typeScale.map((row) => (
            <div key={row.label} className="flex items-baseline gap-4 border-b border-line pb-4 last:border-0 last:pb-0">
              <span className="w-24 flex-none text-caption uppercase text-ink-subtle">{row.label}</span>
              <span className={`flex-1 text-ink ${row.cls}`}>Phim ngắn Việt Nam</span>
              <span className="w-16 flex-none text-right text-caption text-ink-subtle">{row.px}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-caption text-ink-subtle">* desktop / mobile. Body line-height 1.65, uppercase labels +0.1em tracking.</p>
      </section>

      <section className="mt-14">
        <h2 className="mb-6 text-h3 font-semibold text-ink">{t("ds.spacing")}</h2>
        <div className="flex items-end gap-6 rounded-lg border border-line bg-surface p-6">
          {spacing.map((s) => (
            <div key={s} className="flex flex-col items-center gap-3">
              <div className="h-16 rounded-md bg-brand-soft" style={{ width: s }} />
              <span className="text-caption text-ink-muted">{s}px</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-caption text-ink-subtle">4px base. 16 / 24 / 40 / 64 are the workhorse gaps. Never 2 / 6 / 10.</p>
      </section>

      <section className="mt-14">
        <h2 className="mb-6 text-h3 font-semibold text-ink">{t("ds.components")}</h2>

        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-6">
          <button className={buttonVariants({ variant: "primary" })}>Primary</button>
          <button className={buttonVariants({ variant: "secondary" })}>Secondary</button>
          <button className={buttonVariants({ variant: "ghost" })}>Ghost</button>
          <button className={buttonVariants({ variant: "gold" })}>VIP</button>
          <button className={buttonVariants({ variant: "primary" })} disabled>Disabled</button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-6">
          <Badge variant="default">Default</Badge>
          <Badge variant="vip">VIP</Badge>
          <Badge variant="free">Miễn phí</Badge>
          <Badge variant="hot">Hot</Badge>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-6">
          <input
            className="h-11 w-full max-w-sm rounded-md border border-line bg-surface-2 px-4 text-body text-ink outline-none placeholder:text-ink-subtle"
            placeholder="Email của bạn..."
          />
        </div>

        <div className="mt-4 max-w-[220px] rounded-lg border border-line bg-surface p-6">
          <DramaCard drama={dramas[0]} />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="mb-6 text-h3 font-semibold text-ink">{t("ds.states")}</h2>
        <div className="rounded-lg border border-line bg-surface p-6">
          <p className="text-body text-ink-muted">
            Mọi phần tử tương tác có 5 trạng thái: default / hover / active / focus-visible / disabled.
            Focus ring (viền màu brand) hiện khi duyệt bằng bàn phím — thử Tab qua các nút bên trên.
          </p>
        </div>
      </section>
    </div>
  );
}
