"use client";

import { useState } from "react";
import { apiPost, ApiError, errMessage } from "@/lib/client";

export function TransferCard() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amt = Number(amount);
  const valid = from.trim() && to.trim() && Number.isFinite(amt) && amt > 0;
  // Privacy is account-driven: a Private/ sender or recipient triggers proof gen.
  const isPrivate = /^Private\//i.test(from.trim()) || /^Private\//i.test(to.trim());

  async function send() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const r = await apiPost<{ raw: string }>("/api/transfer", {
        from: from.trim(),
        to: to.trim(),
        amount: amt,
      });
      setResult(r.raw || "Transfer submitted.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "PROOF_TIMEOUT") {
        setErr(
          "Proof generation timed out. Private transfers can take minutes — raise PROOF_TIMEOUT_SECONDS.",
        );
      } else {
        setErr(errMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Send</h2>
        {isPrivate && (
          <span className="pill bg-accent2/15 text-accent2">🔒 private · ZK proof</span>
        )}
      </div>
      <p className="mb-4 text-xs text-muted">
        Transfer the native token between accounts.{" "}
        {isPrivate ? (
          <span className="text-accent2">
            A Private/ account is involved — this generates a proof locally and can
            take minutes.
          </span>
        ) : (
          <span>Use a Private/ account as sender or recipient for a private transfer.</span>
        )}
      </p>

      <label className="label">From (account id)</label>
      <input
        className="input mb-3"
        placeholder="Public/…"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <label className="label">To (account id)</label>
      <input
        className="input mb-3"
        placeholder="Public/…"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <label className="label">Amount</label>
      <input
        className="input mb-4"
        type="number"
        min="0"
        placeholder="37"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <button
        className={isPrivate ? "btn w-full bg-accent2 text-white hover:bg-accent2/90" : "btn-primary w-full"}
        disabled={!valid || loading}
        onClick={send}
      >
        {loading
          ? isPrivate
            ? "Generating proof…"
            : "Sending…"
          : isPrivate
            ? "Send privately"
            : "Send"}
      </button>

      {loading && isPrivate && (
        <p className="mt-3 text-center text-xs text-accent2">
          ⏳ Building the zero-knowledge proof on this machine. Keep this tab open.
        </p>
      )}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      {result && (
        <div className="mt-4 rounded-lg border border-ok/30 bg-ok/10 p-3 text-xs text-ok">
          <div className="mb-1 font-semibold">✓ Done</div>
          <pre className="overflow-auto whitespace-pre-wrap">{result}</pre>
        </div>
      )}
    </div>
  );
}
