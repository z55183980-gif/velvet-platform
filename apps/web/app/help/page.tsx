"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n";
import {
  fetchAuthCaptcha,
  getAuthChannels,
  submitFeedback,
  type FeedbackCategory,
} from "@/lib/api";

const BODY_MIN = 10;
const BODY_MAX = 1000;

const inputCls =
  "w-full rounded-xl border border-line bg-surface-3 px-4 py-3 text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand";

type CaptchaChallenge = {
  captchaId: string;
  imageSvg: string;
  captchaRequired: boolean;
};

const CATEGORIES: FeedbackCategory[] = ["feedback", "complaint", "suggestion"];

export default function HelpPage() {
  const { t, locale } = useLocale();
  const [category, setCategory] = useState<FeedbackCategory>("feedback");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
    let cancelled = false;
    getAuthChannels()
      .then((c) => {
        if (cancelled) return;
        if (c.captcha?.enabled !== false) void loadCaptcha();
        else setCaptcha({ captchaId: "", imageSvg: "", captchaRequired: false });
      })
      .catch(() => {
        if (!cancelled) void loadCaptcha();
      });
    return () => {
      cancelled = true;
    };
  }, [loadCaptcha]);

  const captchaRequired = captcha?.captchaRequired !== false;
  const bodyLen = body.trim().length;
  const emailTrimmed = email.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const canSubmit =
    !busy &&
    !done &&
    emailOk &&
    bodyLen >= BODY_MIN &&
    bodyLen <= BODY_MAX &&
    (!captchaRequired || (!!captcha?.captchaId && captchaCode.trim().length >= 4));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!emailOk || bodyLen < BODY_MIN || bodyLen > BODY_MAX) return;
    if (captchaRequired && !(captcha?.captchaId && captchaCode.trim().length >= 4)) {
      setErr(t("help.captchaRequired"));
      return;
    }
    setBusy(true);
    try {
      await submitFeedback({
        category,
        body: body.trim(),
        contactEmail: emailTrimmed,
        locale,
        ...(captchaRequired && captcha?.captchaId
          ? { captchaId: captcha.captchaId, captchaCode: captchaCode.trim() }
          : {}),
      });
      setDone(true);
      setBody("");
      setEmail("");
      setCaptchaCode("");
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : t("login.verifyFail"));
      if (captchaRequired) void loadCaptcha();
    } finally {
      setBusy(false);
    }
  };

  const categoryLabel = (c: FeedbackCategory) => {
    if (c === "complaint") return t("help.categoryComplaint");
    if (c === "suggestion") return t("help.categorySuggestion");
    return t("help.categoryFeedback");
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{t("help.title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t("help.intro")}</p>

      <section id="feedback" className="mt-10 scroll-mt-24">
        <h2 className="text-lg font-medium text-ink">{t("help.formTitle")}</h2>

        {done ? (
          <p className="mt-6 rounded-xl border border-line bg-surface-2 px-4 py-4 text-sm text-ink">
            {t("help.success")}
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("help.categoryLabel")}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={
                      category === c
                        ? "rounded-full bg-brand px-3.5 py-1.5 text-sm font-medium text-white"
                        : "rounded-full bg-surface-2 px-3.5 py-1.5 text-sm text-ink-muted hover:bg-surface-3 hover:text-ink"
                    }
                  >
                    {categoryLabel(c)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="help-email" className="mb-2 block text-sm text-ink-muted">
                {t("help.emailLabel")}
                <span className="ml-0.5 text-danger" aria-hidden>
                  *
                </span>
              </label>
              <input
                id="help-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value.slice(0, 120))}
                placeholder={t("help.emailPlaceholder")}
                className={inputCls}
                maxLength={120}
              />
            </div>

            <div>
              <label htmlFor="help-body" className="mb-2 block text-sm text-ink-muted">
                {t("help.bodyLabel")}
              </label>
              <textarea
                id="help-body"
                name="body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                placeholder={t("help.bodyPlaceholder")}
                className={`${inputCls} resize-y min-h-[8rem]`}
                maxLength={BODY_MAX}
                required
              />
              <p className="mt-1.5 text-right text-xs text-ink-subtle">
                {t("help.bodyCount", { n: bodyLen, max: BODY_MAX })}
              </p>
            </div>

            {captchaRequired ? (
              <div className="flex items-center gap-3">
                <input
                  name="captcha"
                  aria-label={t("login.captchaPlaceholder")}
                  value={captchaCode}
                  onChange={(e) => setCaptchaCode(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder={t("login.captchaPlaceholder")}
                  autoComplete="off"
                  className={`${inputCls} min-w-0 flex-1`}
                  maxLength={8}
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

            {err ? <p className="text-sm text-danger">{err}</p> : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? t("help.submitting") : t("help.submit")}
            </button>
          </form>
        )}
      </section>

      <section className="mt-14 border-t border-line pt-10">
        <h2 className="text-lg font-medium text-ink">{t("help.copyrightTitle")}</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <p>{t("help.copyrightBody1")}</p>
          <p>{t("help.copyrightBody2")}</p>
          <p>{t("help.copyrightBody3")}</p>
        </div>
      </section>
    </main>
  );
}
