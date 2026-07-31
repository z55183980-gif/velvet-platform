"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  sendOtp as apiSendOtp,
  verifyOtp as apiVerifyOtp,
  sendEmailOtp as apiSendEmailOtp,
  verifyEmailOtp as apiVerifyEmailOtp,
  registerEmail as apiRegisterEmail,
  loginWithPassword as apiLoginPassword,
  forgotPassword as apiForgotPassword,
  resetPassword as apiResetPassword,
  getSession,
  logout as apiLogout,
  getWallet,
  unlockEpisode as apiUnlock,
  type EmailOtpPurpose,
} from "@/lib/api";
import { RechargeModal } from "@/components/recharge-modal";
import { useLocale } from "@/lib/i18n";
import { track } from "@/lib/track";

export interface WalletInfo {
  balanceCredits: number;
  totalRechargedCredits: number;
  totalSpentCredits: number;
}

export type AuthUser = {
  phone: string | null;
  email: string | null;
  username?: string | null;
  nickname?: string | null;
  locale: string;
  label: string;
  hasPassword?: boolean;
};

type AuthMode = "login" | "register" | "forgot";

interface AuthValue {
  user: AuthUser | null;
  balance: number | null;
  unlocked: Set<string>;
  ready: boolean;
  loginOpen: boolean;
  openLogin: (mode?: AuthMode) => void;
  closeLogin: () => void;
  rechargeOpen: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
  /** 公测预留：手机 OTP */
  sendOtp: (phone: string) => Promise<{ expiresInSec: number; devCode?: string }>;
  verify: (phone: string, code: string) => Promise<void>;
  /** 公测预留：邮箱 OTP；内测找回密码也会用到 reset purpose */
  sendEmailOtp: (
    email: string,
    purpose?: EmailOtpPurpose,
  ) => Promise<{ expiresInSec: number; devCode?: string; mailed?: boolean }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  register: (opts: {
    email: string;
    username: string;
    password: string;
    code?: string;
    nickname?: string;
  }) => Promise<void>;
  loginPassword: (account: string, password: string) => Promise<void>;
  forgot: (email: string) => Promise<{ expiresInSec: number; devCode?: string; mailed?: boolean }>;
  reset: (opts: { email: string; code: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  applySession: (s?: any, fallback?: string) => Promise<void>;
  unlock: (episodeId: string | number) => Promise<{
    ok: boolean;
    alreadyUnlocked: boolean;
    error?: string;
    code?: number;
  }>;
}

const AuthContext = createContext<AuthValue | null>(null);

function toUser(s: any, fallback?: string): AuthUser {
  const phone = s?.phone ?? null;
  const email = s?.email ?? null;
  const username = s?.username ?? null;
  const nickname = s?.nickname ?? null;
  const label = nickname || username || email || phone || fallback || "user";
  return {
    phone,
    email,
    username,
    nickname,
    locale: s?.locale || "vi",
    label,
    hasPassword: !!s?.hasPassword,
  };
}

const inputCls =
  "w-full rounded-xl border border-line bg-surface-3 px-4 py-3 text-white outline-none transition-colors placeholder:text-ink-subtle focus:border-brand";
const primaryBtnCls =
  "w-full rounded-xl bg-brand py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const linkBtnCls = "w-full text-center text-sm text-ink-muted hover:text-white";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<AuthMode>("login");
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const refreshWallet = useCallback(async () => {
    const w = await getWallet();
    setBalance(w ? Number(w.balanceCredits) : null);
  }, []);

  const applySession = useCallback(
    async (s?: any, fallback?: string) => {
      const session = s || (await getSession());
      if (session && (session.phone || session.email || session.username || session.id)) {
        setUser(toUser(session, fallback));
        await refreshWallet();
        return true;
      }
      return false;
    },
    [refreshWallet],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSession();
        if (cancelled) return;
        if (s && (s.phone || s.email || s.username || s.id)) {
          setUser(toUser(s));
          void refreshWallet();
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshWallet]);

  // 切回前台时用 cookie+token 再校验一次，避免短暂失败被当成未登录
  useEffect(() => {
    if (!ready) return;
    const revalidate = () => {
      void getSession().then((s) => {
        if (s && (s.phone || s.email || s.username || s.id)) {
          setUser(toUser(s));
          void refreshWallet();
        }
      });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready, refreshWallet]);

  const openLogin = useCallback((mode: AuthMode = "login") => {
    setLoginInitialMode(mode);
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  const openRecharge = useCallback(() => setRechargeOpen(true), []);
  const closeRecharge = useCallback(() => setRechargeOpen(false), []);

  const sendOtp = useCallback((phone: string) => apiSendOtp(phone), []);
  const verify = useCallback(
    async (phone: string, code: string) => {
      const data = await apiVerifyOtp(phone, code);
      setLoginOpen(false);
      await applySession((data as any)?.user, phone);
      track("login", { method: "phone_otp" });
    },
    [applySession],
  );

  const sendEmailOtp = useCallback(
    (email: string, purpose: EmailOtpPurpose = "login") => apiSendEmailOtp(email, purpose),
    [],
  );
  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      const data = await apiVerifyEmailOtp(email, code);
      setLoginOpen(false);
      await applySession((data as any)?.user, email);
      track("login", { method: "email_otp" });
    },
    [applySession],
  );

  const register = useCallback(
    async (opts: {
      email: string;
      username: string;
      password: string;
      code?: string;
      nickname?: string;
    }) => {
      const data = await apiRegisterEmail(opts);
      setLoginOpen(false);
      await applySession((data as any)?.user, opts.username || opts.email);
      track("register", { method: "email" });
    },
    [applySession],
  );

  const loginPassword = useCallback(
    async (account: string, password: string) => {
      const data = await apiLoginPassword(account, password);
      setLoginOpen(false);
      await applySession((data as any)?.user, account);
      track("login", { method: "password" });
    },
    [applySession],
  );

  const forgot = useCallback((email: string) => apiForgotPassword(email), []);
  const reset = useCallback(
    async (opts: { email: string; code: string; password: string }) => {
      const data = await apiResetPassword(opts);
      setLoginOpen(false);
      await applySession((data as any)?.user, opts.email);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setBalance(null);
    setUnlocked(new Set());
  }, []);

  const unlock = useCallback(
    async (episodeId: string | number) => {
      if (!user) {
        setLoginOpen(true);
        return { ok: false, alreadyUnlocked: false, error: "need_login" };
      }
      try {
        const r = await apiUnlock(episodeId);
        setUnlocked((prev) => new Set(prev).add(String(episodeId)));
        await refreshWallet();
        track("unlock", {
          episodeId: String(episodeId),
          alreadyUnlocked: !!r.alreadyUnlocked,
        });
        return { ok: true, alreadyUnlocked: !!r.alreadyUnlocked };
      } catch (e: any) {
        track("unlock_fail", {
          episodeId: String(episodeId),
          error: e?.message || "fail",
        });
        return {
          ok: false,
          alreadyUnlocked: false,
          error: e?.message || "fail",
          // ApiError.status 为业务码（如 4100 余额不足）
          code: typeof e?.status === "number" ? e.status : undefined,
        };
      }
    },
    [user, refreshWallet],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        balance,
        unlocked,
        ready,
        loginOpen,
        openLogin,
        closeLogin,
        rechargeOpen,
        openRecharge,
        closeRecharge,
        sendOtp,
        verify,
        sendEmailOtp,
        verifyEmail,
        register,
        loginPassword,
        forgot,
        reset,
        logout,
        refreshWallet,
        applySession,
        unlock,
      }}
    >
      {children}
      {loginOpen && <LoginModal initialMode={loginInitialMode} />}
      <RechargeModal open={rechargeOpen} onClose={closeRecharge} />
    </AuthContext.Provider>
  );
}

/**
 * 内测登录窗：登录 / 注册 / 找回密码。
 * 公测预留的手机/邮箱 OTP 接口在后端，本窗默认不展示。
 */
function LoginModal({ initialMode }: { initialMode: AuthMode }) {
  const ctx = useAuth();
  const { t } = useLocale();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [mailed, setMailed] = useState<boolean | null>(null);

  const switchMode = (m: AuthMode) => {
    setMode(m);
    setStep("form");
    setCode("");
    setPassword("");
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

  const canLogin = account.trim().length >= 2 && password.length >= 6;
  const canRegister =
    email.includes("@") &&
    /^[a-zA-Z0-9_]{3,24}$/.test(username.trim()) &&
    password.length >= 6;
  const canSendReset = email.includes("@");
  const canReset = email.includes("@") && code.length >= 4 && password.length >= 6;

  const onLogin = async () => {
    setErr(null);
    setBusy(true);
    try {
      await ctx.loginPassword(account.trim(), password);
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    setErr(null);
    setBusy(true);
    try {
      await ctx.register({
        email: email.trim(),
        username: username.trim(),
        password,
      });
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
    } finally {
      setBusy(false);
    }
  };

  const onSendResetCode = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await ctx.forgot(email.trim());
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
      await ctx.reset({ email: email.trim(), code, password });
    } catch (e: any) {
      setErr(e?.message || t("login.verifyFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={ctx.closeLogin} />
      <div className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-3 max-h-[90vh] overflow-y-auto">
        <button
          onClick={ctx.closeLogin}
          className="absolute right-4 top-4 text-ink-muted transition-colors hover:text-white"
          aria-label="close"
        >
          ✕
        </button>
        <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
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
                    ? "bg-surface text-white shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {k === "login" ? t("login.tabLogin") : t("login.tabRegister")}
              </button>
            ))}
          </div>
        )}

        {/* —— 登录 —— */}
        {mode === "login" && (
          <div className="mt-5 space-y-3">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t("login.accountPlaceholder")}
              autoComplete="username"
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

        {/* —— 注册 —— */}
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
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              autoComplete="username"
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

        {/* —— 忘记密码：发识别码 —— */}
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

        {/* —— 忘记密码：填识别码 + 新密码 —— */}
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

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
      </div>
    </div>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
