"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
import { VipModal } from "@/components/vip-modal";
import { LoginModal, type AuthMode } from "@/components/login-modal";
import { track } from "@/lib/track";

export interface WalletInfo {
  balanceCredits: number;
  totalRechargedCredits: number;
  totalSpentCredits: number;
}

export type AuthUser = {
  /** Stable backend user id when session exposes it (preferred cache key). */
  id?: string | null;
  phone: string | null;
  email: string | null;
  username?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  locale: string;
  label: string;
  hasPassword?: boolean;
  isVip?: boolean;
  vipExpireAt?: string | null;
  isCreator?: boolean;
};

interface AuthValue {
  user: AuthUser | null;
  balance: number | null;
  unlocked: Set<string>;
  ready: boolean;
  /**
   * Monotonic session generation — bumps on login/logout/identity change.
   * Consumers key signed-URL caches and abort late wallet/session writes with this.
   */
  sessionEpoch: number;
  loginOpen: boolean;
  openLogin: (mode?: AuthMode) => void;
  closeLogin: () => void;
  rechargeOpen: boolean;
  openRecharge: () => void;
  closeRecharge: () => void;
  vipOpen: boolean;
  openVip: () => void;
  closeVip: () => void;
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
    username?: string;
    password: string;
    code?: string;
    nickname?: string;
    captchaId?: string;
    captchaCode?: string;
  }) => Promise<void>;
  loginPassword: (
    account: string,
    password: string,
    captcha?: { captchaId: string; captchaCode: string },
  ) => Promise<void>;
  forgot: (email: string) => Promise<{ expiresInSec: number; devCode?: string; mailed?: boolean }>;
  reset: (opts: { email: string; code: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  applySession: (s?: any, fallback?: string) => Promise<boolean>;
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
  const id =
    s?.id != null && String(s.id).trim() !== "" ? String(s.id) : null;
  const label = nickname || username || email || phone || fallback || "user";
  return {
    id,
    phone,
    email,
    username,
    nickname,
    avatarUrl: s?.avatarUrl ?? null,
    locale: s?.locale || "en",
    label,
    hasPassword: !!s?.hasPassword,
    isVip: !!s?.isVip,
    vipExpireAt: s?.vipExpireAt ?? null,
    isCreator: !!s?.isCreator,
  };
}

/** Shallow identity/session equality — keeps React reference stable when content is unchanged. */
function usersEqual(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.username === b.username &&
    a.nickname === b.nickname &&
    a.avatarUrl === b.avatarUrl &&
    a.locale === b.locale &&
    a.label === b.label &&
    a.hasPassword === b.hasPassword &&
    a.isVip === b.isVip &&
    a.vipExpireAt === b.vipExpireAt &&
    a.isCreator === b.isCreator
  );
}

function principalKey(u: AuthUser | null | undefined): string {
  if (!u) return "guest";
  return String(u.id || u.email || u.phone || u.username || u.label || "user");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<AuthMode>("login");
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [vipOpen, setVipOpen] = useState(false);
  /** Guards late getSession/getWallet responses after account switch. */
  const sessionGenRef = useRef(0);
  const userPrincipalRef = useRef("guest");
  /** Monotonic revalidate seq — newer visibility revalidate wins over late ones. */
  const revalidateSeqRef = useRef(0);

  const bumpSessionEpoch = useCallback((nextPrincipal: string) => {
    if (nextPrincipal === userPrincipalRef.current) return sessionGenRef.current;
    userPrincipalRef.current = nextPrincipal;
    sessionGenRef.current += 1;
    setSessionEpoch(sessionGenRef.current);
    return sessionGenRef.current;
  }, []);

  /** Force epoch bump even when principal string is unchanged (login race / token swap). */
  const forceSessionEpoch = useCallback((nextPrincipal: string) => {
    userPrincipalRef.current = nextPrincipal;
    sessionGenRef.current += 1;
    setSessionEpoch(sessionGenRef.current);
    return sessionGenRef.current;
  }, []);

  const refreshWallet = useCallback(async () => {
    const gen = sessionGenRef.current;
    const w = await getWallet();
    if (gen !== sessionGenRef.current) return;
    setBalance(w ? Number(w.balanceCredits) : null);
  }, []);

  const applySession = useCallback(
    async (s?: any, fallback?: string) => {
      const genAtStart = sessionGenRef.current;
      const seqAtStart = revalidateSeqRef.current;
      const session = s || (await getSession());
      if (genAtStart !== sessionGenRef.current) return false;
      if (seqAtStart !== revalidateSeqRef.current) return false;
      if (session && (session.phone || session.email || session.username || session.id)) {
        const mapped = toUser(session, fallback);
        // Always bump on successful apply so late revalidate cannot overwrite new token/user.
        forceSessionEpoch(principalKey(mapped));
        setUser((prev) => (prev && usersEqual(prev, mapped) ? prev : mapped));
        await refreshWallet();
        return true;
      }
      return false;
    },
    [refreshWallet, forceSessionEpoch],
  );

  useEffect(() => {
    let cancelled = false;
    const genAtStart = sessionGenRef.current;
    (async () => {
      try {
        const s = await getSession();
        if (cancelled || genAtStart !== sessionGenRef.current) return;
        if (s && (s.phone || s.email || s.username || s.id)) {
          const mapped = toUser(s);
          bumpSessionEpoch(principalKey(mapped));
          setUser((prev) => (prev && usersEqual(prev, mapped) ? prev : mapped));
          void refreshWallet();
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshWallet, bumpSessionEpoch]);

  // Full-page Google OAuth return (mobile / popup-blocked fallback)
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const googleOk = url.searchParams.get("google") === "ok";
    const googleError = url.searchParams.get("google_error");
    if (!googleOk && !googleError) return;

    url.searchParams.delete("google");
    url.searchParams.delete("google_error");
    const cleaned = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", cleaned || "/");

    if (googleError) {
      try {
        sessionStorage.setItem("velvet_google_error", googleError);
      } catch {
        /* ignore */
      }
      setLoginInitialMode("login");
      setLoginOpen(true);
      return;
    }

    void (async () => {
      const ok = await applySession();
      if (ok) {
        track("login", { method: "google" });
        setLoginOpen(false);
      } else {
        setLoginInitialMode("login");
        setLoginOpen(true);
      }
    })();
  }, [ready, applySession]);

  // 切回前台时用 cookie+token 再校验一次，避免短暂失败被当成未登录
  useEffect(() => {
    if (!ready) return;
    const revalidate = () => {
      const genAtStart = sessionGenRef.current;
      const seq = ++revalidateSeqRef.current;
      void getSession().then((s) => {
        // Drop if a newer revalidate started, or login/logout bumped epoch.
        if (seq !== revalidateSeqRef.current) return;
        if (genAtStart !== sessionGenRef.current) return;
        if (s && (s.phone || s.email || s.username || s.id)) {
          const mapped = toUser(s);
          bumpSessionEpoch(principalKey(mapped));
          if (seq !== revalidateSeqRef.current) return;
          setUser((prev) => (prev && usersEqual(prev, mapped) ? prev : mapped));
          void refreshWallet();
        } else {
          bumpSessionEpoch("guest");
          if (seq !== revalidateSeqRef.current) return;
          setUser(null);
          setBalance(null);
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
  }, [ready, refreshWallet, bumpSessionEpoch]);

  const openLogin = useCallback((mode: AuthMode = "login") => {
    setLoginInitialMode(mode);
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  const openRecharge = useCallback(() => setRechargeOpen(true), []);
  const closeRecharge = useCallback(() => setRechargeOpen(false), []);
  const openVip = useCallback(() => setVipOpen(true), []);
  const closeVip = useCallback(() => setVipOpen(false), []);

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
      username?: string;
      password: string;
      code?: string;
      nickname?: string;
      captchaId?: string;
      captchaCode?: string;
    }) => {
      const data = await apiRegisterEmail(opts);
      setLoginOpen(false);
      await applySession((data as any)?.user, opts.email);
      track("register", { method: "email" });
    },
    [applySession],
  );

  const loginPassword = useCallback(
    async (
      account: string,
      password: string,
      captcha?: { captchaId: string; captchaCode: string },
    ) => {
      const data = await apiLoginPassword(account, password, captcha);
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
    // Invalidate in-flight session/wallet writes before awaiting logout network.
    forceSessionEpoch("guest");
    revalidateSeqRef.current += 1;
    await apiLogout();
    setUser(null);
    setBalance(null);
    setUnlocked(new Set());
  }, [forceSessionEpoch]);

  const unlock = useCallback(
    async (episodeId: string | number) => {
      if (!user) {
        setLoginOpen(true);
        return { ok: false, alreadyUnlocked: false, error: "need_login" };
      }
      const gen = sessionGenRef.current;
      try {
        const r = await apiUnlock(episodeId);
        if (gen !== sessionGenRef.current) {
          return { ok: false, alreadyUnlocked: false, error: "stale_session" };
        }
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
        sessionEpoch,
        loginOpen,
        openLogin,
        closeLogin,
        rechargeOpen,
        openRecharge,
        closeRecharge,
        vipOpen,
        openVip,
        closeVip,
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
      {loginOpen && (
        <LoginModal
          initialMode={loginInitialMode}
          onClose={closeLogin}
          loginPassword={loginPassword}
          register={register}
          forgot={forgot}
          reset={reset}
          applySession={applySession}
        />
      )}
      <RechargeModal open={rechargeOpen} onClose={closeRecharge} />
      <VipModal open={vipOpen} onClose={closeVip} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
