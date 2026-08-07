"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import {
  fetchAuthCaptcha,
  getAuthChannels,
  getGoogleAuthStartUrl,
  saveAuthToken,
} from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSiteConfig } from "@/lib/site-config";
import { track } from "@/lib/track";

export type AuthMode = "login" | "register" | "forgot";

type CaptchaChallenge = {
  captchaId: string;
  imageSvg: string;
  captchaRequired: boolean;
};

const inputCls =
  "w-full rounded-xl border border-line bg-surface-3 px-4 py-3 text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand";
const primaryBtnCls =
  "w-full rounded-xl bg-brand py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const linkBtnCls = "w-full text-center text-sm text-ink-muted hover:text-ink";
const oauthBtnCls =
  "flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface-3 px-4 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50";

/** Simple email shape check (aligned with API normalizeEmail). */
function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || "").trim());
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.1 5.5l.1.1 6.2 5.2C39.2 36.3 44 31.5 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

function openCenteredPopup(url: string, name: string, w = 520, h = 640) {
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  return window.open(
    url,
    name,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener=no`,
  );
}

export type LoginModalProps = {
  initialMode: AuthMode;
  onClose: () => void;
  loginPassword: (
    account: string,
    password: string,
    captcha?: { captchaId: string; captchaCode: string },
  ) => Promise<void>;
  register: (opts: {
    email: string;
    username?: string;
    password: string;
    code?: string;
    nickname?: string;
    captchaId?: string;
    captchaCode?: string;
  }) => Promise<void>;
  forgot: (email: string) => Promise<{ expiresInSec: number; devCode?: string; mailed?: boolean }>;
  reset: (opts: { email: string; code: string; password: string }) => Promise<void>;
  applySession: (s?: any, fallback?: string) => Promise<boolean>;
};

export function LoginModal({
  initialMode,
  onClose,
  loginPassword,
  register,
  forgot,
  reset,
  applySession,
}: LoginModalProps) {
  const { t } = useLocale();
  const site = useSiteConfig();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [step, setStep] = useState<"form" | "code">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [mailed, setMailed] = useState<boolean | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(true);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const challenge = await fetchAuthCaptcha();
      setCaptcha(challenge);
      setCaptchaCode("");
    } catch {
      setErr(t("login.captchaLoadFailed"));
    } finally {
      setCaptchaLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setMode(initialMode);
    setStep("form");
    setErr(null);
    try {
      const ge = sessionStorage.getItem("velvet_google_error");
      if (ge) {
        sessionStorage.removeItem("velvet_google_error");
        setErr(ge);
      }
    } catch {
      /* ignore */
    }
  }, [initialMode]);

  useEffect(() => {
    let cancelled = false;
    getAuthChannels()
      .then((c) => {
        if (cancelled) return;
        setGoogleEnabled(!!c.google?.enabled);
        if (c.captcha?.enabled !== false) {
          void loadCaptcha();
        } else {
          setCaptcha({ captchaId: "", imageSvg: "", captchaRequired: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleEnabled(false);
          void loadCaptcha();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadCaptcha]);

  useEffect(() => {
    if (mode === "forgot") return;
    if (captcha?.captchaRequired) void loadCaptcha();
    // refresh image when switching login/register
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.type !== "velvet-oauth") return;
      if (ev.origin !== window.location.origin) return;
      void (async () => {
        if (!data.ok || !data.token) {
          setErr(data.error || t("login.googleFail"));
          setBusy(false);
          return;
        }
        saveAuthToken(data.token);
        setBusy(false);
        await applySession(data.user);
        track("login", { method: "google" });
        onClose();
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applySession, onClose, t]);

  const switchMode = (m: AuthMode) => {
    setMode(m);
    setStep("form");
    setCode("");
    setPassword("");
    setPasswordConfirm("");
    setDevCode(null);
    setMailed(null);
    setErr(null);
  };

  const title =
    mode === "register"
      ? t("login.registerTitle")
      : mode === "forgot"
        ? t("login.forgotTitle")
        : t("login.title");
  const subtitle =
    mode === "register"
      ? t("login.registerSubtitle")
      : mode === "forgot"
        ? t("login.forgotSubtitle")
        : t("login.subtitle");

  const captchaRequired = captcha?.captchaRequired !== false;
  const captchaReady =
    !captchaRequired ||
    (!!captcha?.captchaId && captchaCode.trim().length >= 4);
  const canLogin = account.trim().length >= 3 && password.length >= 6 && captchaReady;
  const canRegister =
    isValidEmail(email) &&
    password.length >= 6 &&
    password === passwordConfirm &&
    captchaReady;
  const canSendReset = isValidEmail(email);
  const canReset = isValidEmail(email) && code.length >= 4 && password.length >= 6;

  const captchaPayload = () =>
    captchaRequired && captcha?.captchaId
      ? { captchaId: captcha.captchaId, captchaCode: captchaCode.trim() }
      : undefined;

  const onGoogle = () => {
    setErr(null);
    if (!googleEnabled) {
      setErr(t("login.googleDisabled"));
      return;
    }
    const returnTo =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}` || "/"
        : "/";
    const preferRedirect =
      typeof window !== "undefined" &&
      (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        window.matchMedia("(pointer: coarse)").matches ||
        window.innerWidth < 768);

    setBusy(true);
    if (preferRedirect) {
      window.location.assign(
        getGoogleAuthStartUrl(window.location.origin, { mode: "redirect", returnTo }),
      );
      return;
    }

    const popup = openCenteredPopup(
      getGoogleAuthStartUrl(window.location.origin, { mode: "popup", returnTo }),
      "velvet-google",
    );
    if (!popup) {
      // Desktop popup blocked → fall back to same-tab redirect
      window.location.assign(
        getGoogleAuthStartUrl(window.location.origin, { mode: "redirect", returnTo }),
      );
      return;
    }
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        setBusy(false);
      }
    }, 500);
  };

  const onLogin = async () => {
    setErr(null);
    if (captchaRequired && !captchaPayload()) {
      setErr(t("login.captchaRequired"));
      return;
    }
    setBusy(true);
    try {
      await loginPassword(account.trim(), password, captchaPayload());
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
      if (captchaRequired) void loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    setErr(null);
    if (!isValidEmail(email)) {
      setErr(t("login.invalidEmail"));
      return;
    }
    if (password !== passwordConfirm) {
      setErr(t("login.passwordMismatch"));
      return;
    }
    const cap = captchaPayload();
    if (captchaRequired && !cap) {
      setErr(t("login.captchaRequired"));
      return;
    }
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        password,
        ...(cap
          ? { captchaId: cap.captchaId, captchaCode: cap.captchaCode }
          : {}),
      });
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
      if (captchaRequired) void loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const onSendResetCode = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await forgot(email.trim());
      setDevCode(r.devCode ?? null);
      setMailed(r.mailed ?? null);
      setStep("code");
    } catch (e: any) {
      setErr(e?.message || t("login.sendFail"));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setErr(null);
    setBusy(true);
    try {
      await reset({ email: email.trim(), code, password });
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
    } finally {
      setBusy(false);
    }
  };

  const showGoogle = mode !== "forgot" && step === "form";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="auth-modal-dark relative flex w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-3 max-h-[92vh] md:max-w-3xl">
        <div className="relative hidden w-[42%] shrink-0 md:block">
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(160deg, #1a1210 0%, #2a1814 40%, #0f0b0a 100%), radial-gradient(ellipse at 30% 20%, rgba(200,80,60,0.35), transparent 55%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent, transparent 12px, rgba(255,255,255,0.03) 12px, rgba(255,255,255,0.03) 24px)",
            }}
          />
          <div className="relative flex h-full min-h-[420px] flex-col items-center justify-center gap-4 px-6 py-10">
            <BrandLogo size={56} withWordmark={false} priority />
            <p className="text-2xl font-bold tracking-tight text-white">Velvet</p>
            <p className="max-w-[12rem] text-center text-sm text-white/60">{t("login.brandTagline")}</p>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto p-6 sm:p-8">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-ink-muted transition-colors hover:text-ink"
            aria-label="close"
            type="button"
          >
            ✕
          </button>

          <div className="mb-5 flex items-center gap-2 md:hidden">
            <BrandLogo size={28} withWordmark={false} />
            <span className="text-lg font-semibold text-ink">Velvet</span>
          </div>

          <h2 className="pr-8 text-xl font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>

          {mode !== "forgot" && (
            <div className="mt-5 flex rounded-xl bg-surface-3 p-1">
              {(["login", "register"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchMode(k)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                    mode === k
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {k === "login" ? t("login.tabLogin") : t("login.tabRegister")}
                </button>
              ))}
            </div>
          )}

          {mode === "login" && (
            <div className="mt-5 space-y-3">
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                inputMode="email"
                autoComplete="email"
                className={inputCls}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login.passwordPlaceholder")}
                autoComplete="current-password"
                className={inputCls}
              />
              {captchaRequired ? (
                <div className="flex items-center gap-3">
                  <input
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                    placeholder={t("login.captchaPlaceholder")}
                    autoComplete="off"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    className="inline-flex h-[50px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-3 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    onClick={() => void loadCaptcha()}
                    disabled={captchaLoading}
                    aria-label={t("login.refreshCaptcha")}
                    title={t("login.refreshCaptcha")}
                  >
                    {captcha?.imageSvg ? (
                      <span
                        className="inline-flex h-full w-full items-center justify-center [&_svg]:h-full [&_svg]:w-full"
                        dangerouslySetInnerHTML={{ __html: captcha.imageSvg }}
                      />
                    ) : (
                      <span className="text-xs text-ink-muted">…</span>
                    )}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onLogin}
                disabled={busy || !canLogin}
                className={primaryBtnCls}
              >
                {busy ? t("login.verifying") : t("login.confirm")}
              </button>
              <button type="button" onClick={() => switchMode("forgot")} className={linkBtnCls}>
                {t("login.forgotLink")}
              </button>
            </div>
          )}

          {mode === "register" && (
            <div className="mt-5 space-y-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                inputMode="email"
                autoComplete="email"
                className={inputCls}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login.setPasswordPlaceholder")}
                autoComplete="new-password"
                className={inputCls}
              />
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder={t("login.confirmPasswordPlaceholder")}
                autoComplete="new-password"
                className={inputCls}
              />
              {captchaRequired ? (
                <div className="flex items-center gap-3">
                  <input
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                    placeholder={t("login.captchaPlaceholder")}
                    autoComplete="off"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    className="inline-flex h-[50px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-3 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    onClick={() => void loadCaptcha()}
                    disabled={captchaLoading}
                    aria-label={t("login.refreshCaptcha")}
                    title={t("login.refreshCaptcha")}
                  >
                    {captcha?.imageSvg ? (
                      <span
                        className="inline-flex h-full w-full items-center justify-center [&_svg]:h-full [&_svg]:w-full"
                        dangerouslySetInnerHTML={{ __html: captcha.imageSvg }}
                      />
                    ) : (
                      <span className="text-xs text-ink-muted">…</span>
                    )}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onRegister}
                disabled={busy || !canRegister}
                className={primaryBtnCls}
              >
                {busy ? t("login.verifying") : t("login.registerConfirm")}
              </button>
            </div>
          )}

          {mode === "forgot" && step === "form" && (
            <div className="mt-5 space-y-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                inputMode="email"
                autoComplete="email"
                className={inputCls}
              />
              <button
                type="button"
                onClick={onSendResetCode}
                disabled={busy || !canSendReset}
                className={primaryBtnCls}
              >
                {busy ? t("login.sending") : t("login.sendResetCode")}
              </button>
              <button type="button" onClick={() => switchMode("login")} className={linkBtnCls}>
                {t("login.backToLogin")}
              </button>
            </div>
          )}

          {mode === "forgot" && step === "code" && (
            <div className="mt-5 space-y-3">
              <p className="text-xs text-ink-subtle">{t("login.resetCodeHint")}</p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("login.resetCodePlaceholder")}
                inputMode="numeric"
                className={`${inputCls} text-center text-lg tracking-[0.3em]`}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login.newPasswordPlaceholder")}
                autoComplete="new-password"
                className={inputCls}
              />
              {devCode && (
                <p className="text-center text-xs text-ink-subtle">
                  Dev: <span className="font-mono text-gold">{devCode}</span>
                  {mailed === false && (
                    <span className="ml-2">{t("login.smtpNotConfigured")}</span>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={onReset}
                disabled={busy || !canReset}
                className={primaryBtnCls}
              >
                {busy ? t("login.verifying") : t("login.resetConfirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setCode("");
                  setPassword("");
                  setDevCode(null);
                }}
                className={linkBtnCls}
              >
                {t("login.changeIdentity")}
              </button>
            </div>
          )}

          {showGoogle && (
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs text-ink-subtle">{t("login.or")}</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <button type="button" onClick={onGoogle} disabled={busy} className={oauthBtnCls}>
                <GoogleIcon />
                {busy ? t("login.verifying") : t("login.withGoogle")}
              </button>
            </div>
          )}

          {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-subtle">
            {t("login.agreePrefix")}{" "}
            <Link
              href={site.termsUrl || "/terms"}
              target="_blank"
              className="text-sky-400 hover:underline"
            >
              {t("login.terms")}
            </Link>{" "}
            {t("login.agreeAnd")}{" "}
            <Link
              href={site.privacyUrl || "/privacy"}
              target="_blank"
              className="text-sky-400 hover:underline"
            >
              {t("login.privacy")}
            </Link>
            {t("login.agreeSuffix")}
          </p>
        </div>
      </div>
    </div>
  );
}
