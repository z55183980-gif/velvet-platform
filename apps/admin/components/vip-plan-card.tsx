"use client";

import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Badge, Button, cn } from "@velvet/ui";

export type VipPlanCardModel = {
  id: string;
  name?: string | null;
  durationDays: number;
  basePrice: number | string;
  sortOrder?: number;
  active?: boolean;
  badge?: string | null;
  updatedAt?: string;
};

export function VipPlanGrid({ children }: { children: ReactNode }) {
  return <div className="vip-plan-grid">{children}</div>;
}

export function VipPlanCard({
  displayName,
  badge,
  featured,
  archived,
  isEditing,
  description,
  priceLabel,
  priceSuffix,
  benefitPoints,
  ctaLabel,
  adminMeta,
  adminFootnote,
  actions,
}: {
  displayName: string;
  badge?: string;
  featured?: boolean;
  archived?: boolean;
  isEditing?: boolean;
  description: string;
  priceLabel: string;
  priceSuffix: string;
  benefitPoints: string[];
  ctaLabel: string;
  adminMeta?: ReactNode;
  adminFootnote?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article
      className={cn(
        "vip-plan-card",
        archived && "vip-plan-card--archived",
        featured && !archived && "vip-plan-card--featured",
        isEditing && "vip-plan-card--editing",
      )}
    >
      {badge ? (
        <span
          className={cn(
            "vip-plan-card-badge",
            archived && "vip-plan-card-badge--archived",
            featured && !archived && "vip-plan-card-badge--featured",
          )}
        >
          {badge}
        </span>
      ) : null}

      <h4 className="vip-plan-card-name">{displayName}</h4>

      <div className="vip-plan-card-price-block">
        <p className="vip-plan-card-price">
          {priceLabel}
          <span className="vip-plan-card-price-suffix"> / {priceSuffix}</span>
        </p>
      </div>

      <p className="vip-plan-card-summary">{description}</p>

      <div className="vip-plan-card-actions">
        <button
          type="button"
          disabled
          className={cn(
            "vip-plan-card-cta",
            featured && !archived && "vip-plan-card-cta--featured",
            archived && "vip-plan-card-cta--archived",
          )}
        >
          {ctaLabel}
        </button>
      </div>

      {benefitPoints.length ? (
        <ul className="vip-plan-card-features">
          {benefitPoints.map((point) => (
            <li key={point} className="vip-plan-card-feature">
              <CheckCircle2 className="vip-plan-card-feature-icon" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {adminMeta || actions || adminFootnote ? (
        <div className="vip-plan-card-footer">
          {adminMeta ? <div className="vip-plan-card-admin-meta">{adminMeta}</div> : null}
          {actions ? <div className="vip-plan-card-admin-actions">{actions}</div> : null}
          {adminFootnote ? <div className="vip-plan-card-footnote">{adminFootnote}</div> : null}
        </div>
      ) : null}
    </article>
  );
}

export function VipPlanAdminCard({
  plan,
  isEditing,
  benefitPoints,
  daysLabel,
  selectLabel,
  unnamedLabel,
  onEdit,
  onToggleShelf,
  editLabel,
  onShelfLabel,
  offShelfLabel,
}: {
  plan: VipPlanCardModel;
  isEditing?: boolean;
  benefitPoints: string[];
  daysLabel: string;
  selectLabel: string;
  unnamedLabel: string;
  onEdit: () => void;
  onToggleShelf: () => void;
  editLabel: string;
  onShelfLabel: string;
  offShelfLabel: string;
}) {
  const price = Number(plan.basePrice);
  const displayName = plan.name?.trim() || unnamedLabel;
  const featured = Boolean(plan.badge?.trim()) && !!plan.active;
  const archived = !plan.active;

  return (
    <VipPlanCard
      displayName={displayName}
      badge={plan.badge?.trim() || undefined}
      featured={featured}
      archived={archived}
      isEditing={isEditing}
      description={daysLabel}
      priceLabel={`$${Number.isFinite(price) ? price.toFixed(price % 1 === 0 ? 0 : 2) : "0"}`}
      priceSuffix="USD"
      benefitPoints={benefitPoints}
      ctaLabel={selectLabel}
      adminMeta={
        <>
          <Badge tone={plan.active ? "success" : "default"}>{plan.active ? onShelfLabel : offShelfLabel}</Badge>
          <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-ink-muted">
            {daysLabel}
          </span>
          <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-ink-muted">
            #{plan.sortOrder ?? 0}
          </span>
        </>
      }
      adminFootnote={
        <>
          <span className="font-mono">{plan.id}</span>
          {plan.name ? <span>{plan.name}</span> : null}
        </>
      }
      actions={
        <>
          <Button size="sm" onClick={onEdit}>
            {editLabel}
          </Button>
          <Button
            size="sm"
            variant={plan.active ? "danger" : "secondary"}
            onClick={onToggleShelf}
          >
            {plan.active ? offShelfLabel : onShelfLabel}
          </Button>
        </>
      }
    />
  );
}
