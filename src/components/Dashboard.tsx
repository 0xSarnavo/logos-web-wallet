"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  api,
  short,
  ApiError,
  encodeShare,
  decodeShare,
  updateWallet,
  removeWallet,
  type LocalWallet,
} from "@/lib/wallet-client";
import { useTxQueue, type Tx } from "@/lib/tx-queue";
import { Copy, Qr, Share, Drop, Send, Plus, Lock, Trash, Check } from "./icons";

interface AccountBal {
  accountId: string;
  balance: number;
  initialized: boolean;
}
interface Balances {
  public: AccountBal;
  private: AccountBal | null;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function Dashboard({
  wallet,
  wallets,
  onSwitch,
  onAddNew,
  onLock,
  onWalletChanged,
  onRemoved,
}: {
  wallet: LocalWallet;
  wallets: LocalWallet[];
  onSwitch: (w: LocalWallet) => void;
  onAddNew: () => void;
  onLock: () => void;
  onWalletChanged: (w: LocalWallet) => void;
  onRemoved: () => void;
}) {
  const [tab, setTab] = useState<"wallet" | "activity">("wallet");
  const [bal, setBal] = useState<Balances | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { pending } = useTxQueue();

  const refresh = useCallback(async () => {
    try {
      setBal(await api.balance(wallet.walletId));
      setErr(null);
    } catch (e) {
      setErr(msg(e));
    }
  }, [wallet.walletId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  function remove() {
    if (
      confirm(
        "Remove this wallet from THIS browser only?\n\nYour funds stay on-chain and the keys remain in the server vault — you can restore access anytime with your recovery phrase. This just forgets it on this device.",
      )
    ) {
      removeWallet(wallet.walletId);
      onRemoved();
    }
  }

  return (
    <div>
      {/* Top bar */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-panel text-accent">
            <Lock width={16} height={16} />
          </div>
          <select
            className="input h-9 max-w-[200px] cursor-pointer"
            value={wallet.walletId}
            onChange={(e) => onSwitch(wallets.find((w) => w.walletId === e.target.value)!)}
          >
            {wallets.map((w) => (
              <option key={w.walletId} value={w.walletId}>
                {w.label || w.walletId.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn-icon" title="Create / recover another wallet" onClick={onAddNew}>
            <Plus />
          </button>
          <button className="btn-icon" title="Lock" onClick={onLock}>
            <Lock />
          </button>
          <button className="btn-icon hover:!border-danger hover:!text-danger" title="Remove from this device" onClick={remove}>
            <Trash />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 inline-flex rounded-xl border border-border bg-panel p-1">
        <button
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "wallet" ? "bg-panel2 text-white" : "text-muted hover:text-white"}`}
          onClick={() => setTab("wallet")}
        >
          Wallet
        </button>
        <button
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "activity" ? "bg-panel2 text-white" : "text-muted hover:text-white"}`}
          onClick={() => setTab("activity")}
        >
          Activity{pending > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] text-bg">{pending}</span>}
        </button>
      </div>

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      {tab === "wallet" ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PublicCard
              accountId={wallet.publicAccountId}
              balance={bal?.public.balance}
              walletId={wallet.walletId}
              onChanged={refresh}
            />
            {wallet.privateAccountId ? (
              <PrivateCard accountId={wallet.privateAccountId} walletId={wallet.walletId} />
            ) : (
              <AddPrivateCard
                walletId={wallet.walletId}
                onAdded={(pid) => {
                  const updated = updateWallet(wallet.walletId, { privateAccountId: pid });
                  if (updated) onWalletChanged(updated);
                  refresh();
                }}
              />
            )}
          </div>
          <SendCard wallet={wallet} onSent={refresh} />
        </>
      ) : (
        <ActivityPanel />
      )}
    </div>
  );
}

// ── Activity / queue ─────────────────────────────────────────────────────────

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ActivityPanel() {
  const { txs, clearHistory } = useTxQueue();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (txs.length === 0) {
    return (
      <div className="card text-center text-sm text-muted">
        No activity yet. Faucet, send, or add a private account — they run one at a time and show here.
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Activity</h3>
        <button className="text-xs text-muted transition hover:text-white" onClick={clearHistory}>
          Clear history
        </button>
      </div>
      <p className="mb-4 text-xs text-muted">Proofs run one at a time — newest on top.</p>
      <ul className="space-y-2">
        {txs.map((t) => (
          <Row key={t.id} t={t} now={now} />
        ))}
      </ul>
    </div>
  );
}

function Row({ t, now }: { t: Tx; now: number }) {
  const elapsed =
    t.status === "running" && t.startedAt
      ? fmt(now - t.startedAt)
      : t.startedAt && t.finishedAt
        ? fmt(t.finishedAt - t.startedAt)
        : null;

  const dot =
    t.status === "running"
      ? "bg-white animate-pulse"
      : t.status === "done"
        ? "bg-ok"
        : t.status === "error"
          ? "bg-danger"
          : "bg-muted";

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-panel2/50 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t.kind}</span>
            <span className={`pill ${t.privacy === "private" ? "bg-panel text-accent2" : "bg-panel text-muted"}`}>
              {t.privacy}
            </span>
          </div>
          <div className="truncate text-xs text-muted">{t.label}</div>
          {t.error && <div className="truncate text-xs text-danger">{t.error}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs capitalize text-muted">{t.status}</div>
        {elapsed && <div className="font-mono text-xs tabular-nums text-muted">{elapsed}</div>}
      </div>
    </li>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

function AddPrivateCard({ walletId, onAdded }: { walletId: string; onAdded: (pid: string) => void }) {
  const { enqueue } = useTxQueue();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const r = (await enqueue(
        { kind: "Add private", privacy: "private", label: "Initialize private account" },
        () => api.addPrivate(walletId, pw),
      )) as { privateAccountId: string };
      setPw("");
      onAdded(r.privateAccountId);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col border-dashed">
      <div className="mb-1 flex items-center justify-between">
        <span className="pill bg-panel2 text-accent2">Private</span>
        <span className="text-xs text-muted">not added</span>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">
        Add a shielded account for privacy. Initializing it generates a zero-knowledge
        proof and takes a few minutes (runs in the queue).
      </p>
      <div className="mt-auto">
        <input className="input mb-2.5" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {busy && <p className="mb-2.5 text-xs text-muted">Queued — see Activity tab.</p>}
        {err && <p className="mb-2.5 text-xs text-danger">{err}</p>}
        <button className="btn-solid w-full" disabled={!pw || busy} onClick={add}>
          {busy ? "Working…" : "Add private account"}
        </button>
      </div>
    </div>
  );
}

function AddressChip({ accountId }: { accountId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(accountId);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="mt-4 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-panel2/60 px-3 py-2 text-left transition hover:border-muted"
      title="Copy account id"
    >
      <span className="truncate font-mono text-xs text-muted">{short(accountId, 12)}</span>
      <span className="shrink-0 text-muted">{copied ? <Check /> : <Copy />}</span>
    </button>
  );
}

function QrBox({ accountId, show }: { accountId: string; show: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (show && ref.current) {
      QRCode.toCanvas(ref.current, accountId, {
        width: 168,
        margin: 1,
        color: { dark: "#f2f2f4", light: "#16161a" },
      }).catch(() => {});
    }
  }, [show, accountId]);
  if (!show) return null;
  return (
    <div className="mt-4 flex justify-center">
      <canvas ref={ref} className="rounded-xl border border-border bg-panel2 p-2.5" />
    </div>
  );
}

function PublicCard({
  accountId,
  balance,
  walletId,
  onChanged,
}: {
  accountId: string;
  balance: number | undefined;
  walletId: string;
  onChanged: () => void;
}) {
  const { enqueue } = useTxQueue();
  const [showQr, setShowQr] = useState(false);
  const [showFaucet, setShowFaucet] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function faucet() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await enqueue({ kind: "Faucet", privacy: "public", label: "Faucet → Public" }, () =>
        api.faucet(walletId, "public", pw),
      );
      setNote("Faucet claimed.");
      setPw("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between">
        <span className="pill bg-panel2 text-accent">Public</span>
        <div className="text-right">
          <div className="balance leading-none">{balance ?? "—"}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">LGS</div>
        </div>
      </div>
      <AddressChip accountId={accountId} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-ghost btn-xs" onClick={() => setShowQr((v) => !v)}>
          <Qr /> Receive
        </button>
        <button className="btn-ghost btn-xs" onClick={() => setShowFaucet((v) => !v)}>
          <Drop /> Faucet
        </button>
      </div>
      <QrBox accountId={accountId} show={showQr} />
      {showFaucet && (
        <div className="mt-4 flex gap-2">
          <input className="input h-9" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn-solid btn-xs whitespace-nowrap" disabled={!pw || busy} onClick={faucet}>
            {busy ? "…" : "Claim"}
          </button>
        </div>
      )}
      {note && <p className="mt-2.5 text-xs text-ok">{note}</p>}
      {err && <p className="mt-2.5 text-xs text-danger">{err}</p>}
    </div>
  );
}

function PrivateCard({ accountId, walletId }: { accountId: string; walletId: string }) {
  const { enqueue } = useTxQueue();
  const [showQr, setShowQr] = useState(false);
  const [share, setShare] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [pw, setPw] = useState("");
  const [bal, setBal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setErr(null);
    try {
      const r = (await enqueue(
        { kind: "Sync", privacy: "private", label: "Scan shielded notes" },
        () => api.privateBalance(walletId, pw),
      )) as { balance: number };
      setBal(r.balance);
      setPw("");
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function shareKeys() {
    setErr(null);
    try {
      let k;
      try {
        k = await api.keys(walletId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const p = window.prompt("Enter your wallet password to reveal shareable keys:");
          if (!p) return;
          k = await api.fetchKeys(walletId, p);
        } else throw e;
      }
      setShare(encodeShare({ accountId: k.privateAccountId, npk: k.npk, vpk: k.vpk }));
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    }
  }

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between">
        <span className="pill bg-panel2 text-accent2">Private</span>
        <div className="text-right">
          <div className="balance leading-none">{bal ?? "—"}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">
            {bal === null ? "tap sync" : "LGS"}
          </div>
        </div>
      </div>
      <AddressChip accountId={accountId} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-ghost btn-xs" onClick={() => setShowQr((v) => !v)}>
          <Qr /> Receive
        </button>
        <button className="btn-ghost btn-xs" onClick={() => setShowSync((v) => !v)}>
          <Drop /> Sync balance
        </button>
        <button className="btn-ghost btn-xs" onClick={shareKeys}>
          <Share /> Share keys
        </button>
      </div>
      <QrBox accountId={accountId} show={showQr} />
      {share && (
        <div className="mt-4 rounded-xl border border-border bg-panel2/60 p-3">
          <p className="mb-1.5 text-xs text-muted">Share so others can pay you privately:</p>
          <code className="block break-all font-mono text-[10px] text-white/80">{share}</code>
          <button className="btn-ghost btn-xs mt-2.5" onClick={() => navigator.clipboard.writeText(share!)}>
            <Copy /> Copy share code
          </button>
        </div>
      )}
      {showSync && (
        <div className="mt-4">
          <div className="flex gap-2">
            <input className="input h-9" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn-solid btn-xs whitespace-nowrap" disabled={!pw || busy} onClick={sync}>
              {busy ? "…" : "Sync"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Shielded balances need a scan (a few minutes).</p>
        </div>
      )}
      {err && <p className="mt-2.5 text-xs text-danger">{err}</p>}
    </div>
  );
}

function SendCard({ wallet, onSent }: { wallet: LocalWallet; onSent: () => void }) {
  const { enqueue } = useTxQueue();
  const [from, setFrom] = useState<"public" | "private">("public");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amt = Number(amount);
  const shared = decodeShare(to);
  const isPrivate = from === "private" || /^Private\//i.test(to.trim()) || !!shared;
  const valid = to.trim() && Number.isInteger(amt) && amt > 0 && pw;

  async function send() {
    setBusy(true);
    setErr(null);
    setResult(null);
    const label = `Send ${amt} → ${shared ? short(shared.accountId, 6) : short(to.trim(), 8)}`;
    try {
      await enqueue({ kind: "Send", privacy: isPrivate ? "private" : "public", label }, () =>
        shared
          ? api.send(wallet.walletId, { from, toNpk: shared.npk, toVpk: shared.vpk, amount: amt, password: pw })
          : api.send(wallet.walletId, { from, to: to.trim(), amount: amt, password: pw }),
      );
      setResult("Sent.");
      setTo("");
      setAmount("");
      setPw("");
      onSent();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Send</h3>
        {isPrivate && (
          <span className="pill bg-panel2 text-accent2">
            <Share width={12} height={12} /> private · proof
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <label className="label">From</label>
          <select className="input cursor-pointer" value={from} onChange={(e) => setFrom(e.target.value as "public" | "private")}>
            <option value="public">Public</option>
            <option value="private" disabled={!wallet.privateAccountId}>
              Private{wallet.privateAccountId ? "" : " — add one first"}
            </option>
          </select>
        </div>
        <div>
          <label className="label">Amount</label>
          <input className="input font-mono" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
      </div>
      <label className="label mt-3">Recipient</label>
      <input
        className="input font-mono"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Public/…   Private/…   or a share code (lzk1.…)"
      />
      {shared && <p className="mt-1.5 text-xs text-accent2">Paying private account {short(shared.accountId, 8)}</p>}
      <label className="label mt-3">Password</label>
      <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {busy && <p className="mt-3 text-xs text-muted">Queued — see Activity tab.</p>}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      {result && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-ok">
          <Check /> {result}
        </p>
      )}
      <button className={`mt-5 w-full ${isPrivate ? "btn-solid" : "btn-primary"}`} disabled={!valid || busy} onClick={send}>
        <Send width={15} height={15} /> {busy ? "Working…" : "Send"}
      </button>
    </div>
  );
}
