// Browser-side wallet helpers: localStorage wallet list + typed API calls.
"use client";

export interface LocalWallet {
  walletId: string;
  label: string | null;
  publicAccountId: string;
  privateAccountId: string | null;
}

const LIST_KEY = "logos_wallets";
const ACTIVE_KEY = "logos_active_wallet";

export function listWallets(): LocalWallet[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addWallet(w: LocalWallet): void {
  const all = listWallets().filter((x) => x.walletId !== w.walletId);
  all.push(w);
  localStorage.setItem(LIST_KEY, JSON.stringify(all));
  setActive(w.walletId);
}

export function updateWallet(walletId: string, patch: Partial<LocalWallet>): LocalWallet | null {
  const all = listWallets();
  const i = all.findIndex((x) => x.walletId === walletId);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  localStorage.setItem(LIST_KEY, JSON.stringify(all));
  return all[i];
}

export function removeWallet(walletId: string): void {
  const all = listWallets().filter((x) => x.walletId !== walletId);
  localStorage.setItem(LIST_KEY, JSON.stringify(all));
  if (getActiveId() === walletId) {
    if (all[0]) setActive(all[0].walletId);
    else localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}
export function setActive(walletId: string): void {
  localStorage.setItem(ACTIVE_KEY, walletId);
}

// ── API ──────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.code);
  return data as T;
}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.code);
  return data as T;
}

export interface CreatedWallet {
  walletId: string;
  publicAccountId: string;
  privateAccountId: string | null;
  recoveryPhrase: string;
}

interface AccountBal {
  accountId: string;
  balance: number;
  initialized: boolean;
}

export interface SendArgs {
  from: "public" | "private";
  to?: string;
  toNpk?: string;
  toVpk?: string;
  amount: number;
  password: string;
}

export const api = {
  create: (password: string, label?: string) =>
    post<CreatedWallet>("/api/wallet/create", { password, label }),
  recover: (phrase: string, password: string, label?: string) =>
    post<Omit<CreatedWallet, "recoveryPhrase">>("/api/wallet/recover", { phrase, password, label }),
  unlock: (walletId: string, password: string) =>
    post<{ ok: boolean }>("/api/wallet/unlock", { walletId, password }),
  balance: (walletId: string) =>
    get<{ public: AccountBal; private: AccountBal | null }>(`/api/wallet/${walletId}/balance`),
  addPrivate: (walletId: string, password: string) =>
    post<{ privateAccountId: string; npk: string; vpk: string }>(
      `/api/wallet/${walletId}/add-private`,
      { password },
    ),
  keys: (walletId: string) =>
    get<{ privateAccountId: string; npk: string; vpk: string }>(`/api/wallet/${walletId}/keys`),
  // Backfill keys for an older wallet that has no cached npk/vpk (needs password).
  fetchKeys: (walletId: string, password: string) =>
    post<{ privateAccountId: string; npk: string; vpk: string }>(`/api/wallet/${walletId}/keys`, {
      password,
    }),
  faucet: (walletId: string, account: "public" | "private", password: string) =>
    post<{ ok: boolean; raw: string }>(`/api/wallet/${walletId}/faucet`, { account, password }),
  privateBalance: (walletId: string, password: string) =>
    post<{ balance: number }>(`/api/wallet/${walletId}/private-balance`, { password }),
  send: (walletId: string, args: SendArgs) =>
    post<{ ok: boolean; private: boolean; raw: string }>(`/api/wallet/${walletId}/send`, args),
};

export function short(s: string, n = 6): string {
  return s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

// ── Shareable private-account key blob ───────────────────────────────────────
// A recipient shares this string so a sender can pay their PRIVATE account.
export interface ShareKeys {
  accountId: string;
  npk: string;
  vpk: string;
}

export function encodeShare(k: ShareKeys): string {
  const b64 = btoa(JSON.stringify(k)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `lzk1.${b64}`;
}

export function decodeShare(s: string): ShareKeys | null {
  const t = s.trim();
  if (!t.startsWith("lzk1.")) return null;
  try {
    const b64 = t.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const k = JSON.parse(atob(b64));
    if (k?.npk && k?.vpk) return k;
    return null;
  } catch {
    return null;
  }
}
