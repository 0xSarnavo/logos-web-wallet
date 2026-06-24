"use client";

import { useState } from "react";
import { apiGet, HEX64, short, errMessage } from "@/lib/client";

interface BalanceResp {
  key: string;
  balance: number;
  noteCount: number;
  notes: Record<string, number>;
  known: boolean;
}

export function BalanceCard({ initialKey = "" }: { initialKey?: string }) {
  const [key, setKey] = useState(initialKey);
  const [res, setRes] = useState<BalanceResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = HEX64.test(key.trim());

  async function check() {
    setLoading(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await apiGet<BalanceResp>(`/api/balance?key=${key.trim()}`));
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-1 text-lg font-semibold">Check balance</h2>
      <p className="mb-4 text-xs text-muted">
        Read any public account&apos;s balance &amp; UTXO notes straight from the node.
      </p>

      <label className="label">Public account key (64-hex)</label>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="5279d197…1607"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && check()}
        />
        <button
          className="btn-primary whitespace-nowrap"
          disabled={!valid || loading}
          onClick={check}
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </div>
      {!valid && key.length > 0 && (
        <p className="mt-1 text-xs text-warn">Must be exactly 64 hex characters.</p>
      )}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      {res && (
        <div className="mt-4 rounded-lg border border-border bg-panel2 p-4">
          {!res.known ? (
            <p className="text-sm text-muted">
              Key not found on chain yet — balance <b>0</b>.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-semibold text-ok">
                  {res.balance.toLocaleString()}
                </span>
                <span className="text-xs text-muted">{res.noteCount} notes</span>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-white">
                  Show UTXO notes
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
                  {Object.entries(res.notes).map(([id, v]) => (
                    <li key={id} className="flex justify-between gap-3">
                      <span className="text-muted">{short(id, 10)}</span>
                      <span>{v.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
