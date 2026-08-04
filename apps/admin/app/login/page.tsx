"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, RefreshCw } from "lucide-react";
import { ApiError, adminFetchCaptcha, adminLogin, adminMe, getAdminToken } from "@velvet/api-client";
import { useI18n } from "@/lib/i18n";

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

type CaptchaChallenge = {
  captchaId: string;
  imageSvg: string;
  captchaRequired: boolean;
};

export default function AdminLoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const challenge = await adminFetchCaptcha();
      setCaptcha(challenge);
      setCaptchaCode("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("loginCaptchaLoadFailed"));
    } finally {
      setCaptchaLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !token.includes(".")) return;
    adminMe()
      .then(() => router.replace("/dashboard"))
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await adminLogin(
        account.trim(),
        password,
        captcha?.captchaRequired
          ? { captchaId: captcha.captchaId, captchaCode: captchaCode.trim() }
          : undefined,
      );
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) setErr(t("loginBadCredentials"));
        else if (error.status === 400) setErr(error.message || t("loginCaptchaError"));
        else setErr(error.message || t("loginFailed"));
      } else {
        setErr(t("loginFailed"));
      }
      await loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const captchaRequired = captcha?.captchaRequired ?? false;
  const submitDisabled =
    busy || !account || !password || (captchaRequired && !captchaCode.trim());

  return (
    <div className="relative min-h-screen overflow-hidden text-ink">
      <div className="glass-bg" aria-hidden />

      <div className="absolute left-5 top-5 z-10 sm:left-8 sm:top-8">
        <div className="glass flex items-center gap-3 rounded-xl px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Velvet Ops"
            className="h-10 w-10 rounded-lg object-contain ring-1 ring-black/5"
            width={40}
            height={40}
          />
          <span className="text-sm font-medium text-ink">Velvet Ops</span>
        </div>
      </div>

      <div className="absolute right-5 top-5 z-10 sm:right-8 sm:top-8">
        <a href={WEB_URL} className="glass rounded-xl px-3 py-2 text-sm text-ink-muted transition hover:text-ink">
          ← {t("backSite")}
        </a>
      </div>

      <div className="relative z-10 grid min-h-screen place-items-center px-4 py-20">
        <div className="glass-modal w-full max-w-[420px] rounded-3xl p-7 sm:p-8">
          <div className="mb-7 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Velvet"
              className="h-10 w-10 rounded-lg object-contain ring-1 ring-black/5"
              width={40}
              height={40}
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink">{t("loginTitle")}</h1>
              <p className="mt-1 text-sm text-ink-muted">{t("loginSubheading")}</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" autoComplete="on">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">{t("loginAccount")}</span>
              <input
                className="input-field-lg"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoComplete="username"
                placeholder={t("accountPlaceholder")}
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">{t("loginPassword")}</span>
              <input
                type="password"
                className="input-field-lg"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={t("passwordPlaceholder")}
                required
              />
            </label>

            {captchaRequired ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">{t("loginCaptcha")}</span>
                <div className="flex items-center gap-3">
                  <input
                    autoComplete="off"
                    className="input-field-lg min-w-0 flex-1"
                    placeholder={t("captchaPlaceholder")}
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                    required
                  />
                  <button
                    type="button"
                    className="glass inline-flex h-11 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl transition hover:bg-white/60"
                    onClick={() => void loadCaptcha()}
                    disabled={captchaLoading}
                    aria-label={t("refreshCaptcha")}
                    title={t("refreshCaptcha")}
                  >
                    {captcha?.imageSvg ? (
                      <span
                        className="inline-flex h-full w-full items-center justify-center [&_svg]:h-full [&_svg]:w-full"
                        dangerouslySetInnerHTML={{ __html: captcha.imageSvg }}
                      />
                    ) : (
                      <RefreshCw size={16} className="animate-spin text-ink-muted" />
                    )}
                  </button>
                </div>
              </label>
            ) : null}

            {err ? (
              <div className="rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-700 backdrop-blur-sm">
                {err}
              </div>
            ) : null}

            <button type="submit" disabled={submitDisabled} className="btn-primary h-11 w-full font-semibold">
              <LogIn size={17} />
              {busy ? t("loggingIn") : t("loginSubmit")}
            </button>
          </form>

          <p className="mt-6 text-center text-xs leading-5 text-ink-muted">
            {t("loginFooterHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
