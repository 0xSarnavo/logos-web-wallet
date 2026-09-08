"use client";

import { useEffect, useState } from "react";
import {
  api,
  addWallet,
  listWallets,
  getActiveId,
  setActive,
  ApiError,
  type LocalWallet,
} from "@/lib/wallet-client";
import { Dashboard } from "./Dashboard";
import { TxQueueProvider } from "@/lib/tx-queue";
import { Shield, Plus, Lock, Copy, Check } from "./icons";

type View = "loading" | "welcome" | "create" | "recover" | "phrase" | "unlock" | "dashboard";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Brand() {
  return (
    <div className="mb-8 flex flex-col items-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-panel text-accent">
        <Shield width={22} height={22} />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Logos Wallet</h1>
      <p className="mt-1 text-xs text-muted">non-custodial · password-sealed · on-chain proofs</p>
    </div>
  );
}

export function WalletApp() {
  const [view, setView] = useState<View>("loading");
  const [wallets, setWallets] = useState<LocalWallet[]>([]);
  const [active, setActiveWallet] = useState<LocalWallet | null>(null);
  const [newPhrase, setNewPhrase] = useState<string | null>(null);

  useEffect(() => {
    const ws = listWallets();
    setWallets(ws);
    if (ws.length === 0) setView("welcome");
    else {
      const a = ws.find((w) => w.walletId === getActiveId()) ?? ws[0];
      setActiveWallet(a);
      setView("unlock");
    }
  }, []);

  function onOpened(w: LocalWallet) {
    setActive(w.walletId);
    setActiveWallet(w);
    setWallets(listWallets());
    setView("dashboard");
  }

  // Dashboard gets the full width; auth views are centered + narrow.
  if (view === "dashboard" && active) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <TxQueueProvider>
        <Dashboard
          wallet={active}
          wallets={wallets}
          onSwitch={(w) => {
            setActive(w.walletId);
            setActiveWallet(w);
            setView("unlock");
          }}
          onAddNew={() => setView("welcome")}
          onLock={() => setView("unlock")}
          onWalletChanged={(w) => {
            setActiveWallet(w);
            setWallets(listWallets());
          }}
          onRemoved={() => {
            const ws = listWallets();
            setWallets(ws);
            if (ws.length === 0) {
              setActiveWallet(null);
              setView("welcome");
            } else {
              const a = ws.find((w) => w.walletId === getActiveId()) ?? ws[0];
              setActiveWallet(a);
              setView("unlock");
            }
          }}
        />
        </TxQueueProvider>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Brand />

        {view === "loading" && <p className="text-center text-sm text-muted">Loading…</p>}

        {view === "welcome" && (
          <div className="card text-center">
            <h2 className="text-lg font-semibold">Get started</h2>
            <p className="mx-auto mb-6 mt-1 max-w-xs text-sm text-muted">
              Create a new wallet, or restore one from your recovery phrase.
            </p>
            <div className="flex flex-col gap-2.5">
              <button className="btn-primary" onClick={() => setView("create")}>
                <Plus /> Create a new wallet
              </button>
              <button className="btn-ghost" onClick={() => setView("recover")}>
                Recover with phrase
              </button>
            </div>
          </div>
        )}

        {view === "create" && (
          <CreateForm
            onCreated={(w, phrase) => {
              addWallet(w);
              setActiveWallet(w);
              setWallets(listWallets());
              setNewPhrase(phrase);
              setView("phrase");
            }}
            onBack={() => setView(wallets.length ? "unlock" : "welcome")}
          />
        )}

        {view === "recover" && (
          <RecoverForm
            onRecovered={(w) => {
              addWallet(w);
              onOpened(w);
            }}
            onBack={() => setView(wallets.length ? "unlock" : "welcome")}
          />
        )}

        {view === "phrase" && active && newPhrase && (
          <PhraseReveal
            phrase={newPhrase}
            onDone={() => {
              setNewPhrase(null);
              onOpened(active);
            }}
          />
        )}

        {view === "unlock" && active && (
          <UnlockForm
            wallet={active}
            wallets={wallets}
            onPick={(w) => setActiveWallet(w)}
            onUnlocked={() => onOpened(active)}
            onAddNew={() => setView("welcome")}
          />
        )}
      </div>
    </div>
  );
}

function CreateForm({
  onCreated,
  onBack,
}: {
  onCreated: (w: LocalWallet, phrase: string) => void;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = password.length >= 8 && password === confirm;

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.create(password, label || undefined);
      onCreated(
        {
          walletId: r.walletId,
          label: label || null,
          publicAccountId: r.publicAccountId,
          privateAccountId: r.privateAccountId,
        },
        r.recoveryPhrase,
      );
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === "WALLET_CLI_MISSING"
          ? "Wallet engine not available on the server."
          : msg(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold">Create a new wallet</h2>
      <p className="mb-5 mt-1 text-sm text-muted">
        Creates a Public account instantly. Your password encrypts the keys and is
        required for every transaction. Add a Private account anytime.
      </p>
      <label className="label">Label (optional)</label>
      <input className="input mb-4" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main wallet" />
      <label className="label">Password</label>
      <input
        className="input mb-4"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
      />
      <label className="label">Confirm password</label>
      <input
        className="input"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {confirm && password !== confirm && (
        <p className="mt-1.5 text-xs text-danger">Passwords don&apos;t match.</p>
      )}

      {busy && (
        <p className="mt-4 text-xs text-muted">Creating your public account on-chain…</p>
      )}
      {err && <p className="mt-4 text-sm text-danger">{err}</p>}

      <div className="mt-5 flex gap-2.5">
        <button className="btn-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button className="btn-primary flex-1" onClick={create} disabled={!valid || busy}>
          {busy ? "Creating…" : "Create wallet"}
        </button>
      </div>
    </div>
  );
}

function RecoverForm({
  onRecovered,
  onBack,
}: {
  onRecovered: (w: LocalWallet) => void;
  onBack: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const valid = words >= 12 && password.length >= 8;

  async function recover() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.recover(phrase, password, label || undefined);
      onRecovered({
        walletId: r.walletId,
        label: label || null,
        publicAccountId: r.publicAccountId,
        privateAccountId: r.privateAccountId,
      });
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold">Recover a wallet</h2>
      <p className="mb-5 mt-1 text-sm text-muted">Enter your recovery phrase and set a new password.</p>
      <label className="label">Recovery phrase · {words} words</label>
      <textarea
        className="input mb-4 h-24 resize-none font-mono"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="word1 word2 word3 …"
      />
      <label className="label">Label (optional)</label>
      <input className="input mb-4" value={label} onChange={(e) => setLabel(e.target.value)} />
      <label className="label">New password</label>
      <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      {busy && <p className="mt-4 text-xs text-muted">Restoring keys… this can take a few minutes.</p>}
      {err && <p className="mt-4 text-sm text-danger">{err}</p>}
      <div className="mt-5 flex gap-2.5">
        <button className="btn-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button className="btn-primary flex-1" onClick={recover} disabled={!valid || busy}>
          {busy ? "Recovering…" : "Recover wallet"}
        </button>
      </div>
    </div>
  );
}

function PhraseReveal({ phrase, onDone }: { phrase: string; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold">Save your recovery phrase</h2>
      <p className="mb-5 mt-1 text-sm text-muted">
        Shown <span className="text-white">once</span> and never stored. It&apos;s the only way
        to recover your wallet if you forget your password.
      </p>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {phrase.split(" ").map((w, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-panel2/60 px-2.5 py-2">
            <span className="w-4 text-right text-[10px] text-muted">{i + 1}</span>
            <span className="font-mono text-xs">{w}</span>
          </div>
        ))}
      </div>
      <button className="btn-ghost btn-xs mb-5 w-full" onClick={copy}>
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy phrase"}
      </button>
      <label className="mb-4 flex cursor-pointer items-center gap-2.5 text-sm text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-white"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        I&apos;ve saved my recovery phrase somewhere safe.
      </label>
      <button className="btn-primary w-full" disabled={!ack} onClick={onDone}>
        Continue to wallet
      </button>
    </div>
  );
}

function UnlockForm({
  wallet,
  wallets,
  onPick,
  onUnlocked,
  onAddNew,
}: {
  wallet: LocalWallet;
  wallets: LocalWallet[];
  onPick: (w: LocalWallet) => void;
  onUnlocked: () => void;
  onAddNew: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setErr(null);
    try {
      await api.unlock(wallet.walletId, password);
      onUnlocked();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? "Wrong password." : msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-5 flex items-center gap-2 text-muted">
        <Lock width={16} height={16} />
        <h2 className="text-lg font-semibold text-white">Unlock wallet</h2>
      </div>
      {wallets.length > 1 && (
        <>
          <label className="label">Wallet</label>
          <select
            className="input mb-4"
            value={wallet.walletId}
            onChange={(e) => onPick(wallets.find((w) => w.walletId === e.target.value)!)}
          >
            {wallets.map((w) => (
              <option key={w.walletId} value={w.walletId}>
                {w.label || w.walletId.slice(0, 8)}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="label">Password</label>
      <input
        className="input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && password && unlock()}
        autoFocus
        placeholder="Enter your password"
      />
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      <button className="btn-primary mt-5 w-full" disabled={!password || busy} onClick={unlock}>
        {busy ? "Unlocking…" : "Unlock"}
      </button>
      <button className="mt-3 w-full text-xs text-muted transition hover:text-white" onClick={onAddNew}>
        Create or recover another wallet
      </button>
    </div>
  );
}
