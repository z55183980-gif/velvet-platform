"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

function Sep() {
  return <span className="mx-1.5 text-[#747474]">|</span>;
}

function FooterText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-center text-[14px] font-normal leading-7 tracking-[1px] text-[#747474]",
        className,
      )}
    >
      {children}
    </p>
  );
}

function FooterLink({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const className =
    "text-[14px] font-normal leading-7 tracking-[1px] text-[#747474] transition-colors hover:text-ink-muted";
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  if (href.startsWith("mailto:") || href.startsWith("http")) {
    return (
      <a
        href={href}
        className={className}
        target={href.startsWith("mailto:") ? undefined : "_blank"}
        rel="noopener noreferrer nofollow"
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function resolveHref(value: string) {
  return value && !value.startsWith("footer.") ? value : undefined;
}

/** PC footer — centered multi-line legal block (hongguoduanju.com style). */
export function Footer() {
  const { t } = useLocale();

  return (
    <footer className="mt-24 w-full border-t border-white/10">
      <div className="flex w-full flex-col items-center justify-center px-4 pb-[50px] pt-10 md:px-10">
        <FooterText className="flex flex-wrap items-center justify-center">
          <FooterLink href={resolveHref(t("footer.filing1Href"))}>
            {t("footer.filing1")}
          </FooterLink>
          <Sep />
          <FooterLink href={resolveHref(t("footer.filing2Href"))}>
            {t("footer.filing2")}
          </FooterLink>
          <Sep />
          <FooterLink href={resolveHref(t("footer.filing3Href"))}>
            {t("footer.filing3")}
          </FooterLink>
          <Sep />
          <FooterLink href={resolveHref(t("footer.filing4Href"))}>
            {t("footer.filing4")}
          </FooterLink>
        </FooterText>

        <FooterText className="flex flex-wrap items-center justify-center">
          <FooterLink href={resolveHref(t("footer.license1Href"))}>
            {t("footer.license1")}
          </FooterLink>
          <Sep />
          <FooterLink href={resolveHref(t("footer.license2Href"))}>
            {t("footer.license2")}
          </FooterLink>
          <Sep />
          <FooterLink href={resolveHref(t("footer.license3Href"))}>
            {t("footer.license3")}
          </FooterLink>
        </FooterText>

        <FooterText>
          {t("footer.supportLabel")}
          <FooterLink href={`mailto:${t("footer.supportEmail")}`}>
            {t("footer.supportEmail")}
          </FooterLink>
        </FooterText>

        <Link
          href="/"
          className="mt-5 transition-opacity hover:opacity-90"
          aria-label="Velvet"
        >
          <BrandLogo size={28} />
        </Link>
      </div>
    </footer>
  );
}
