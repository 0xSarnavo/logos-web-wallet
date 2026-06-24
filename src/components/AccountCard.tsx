"use client";

import { useState } from "react";
import { apiPost, ApiError, errMessage } from "@/lib/client";

interface CreateResp {
  type: "public" | "private";
  accountId: string | null;
  raw: string;
}

export function AccountCard() {
  const [acct, setAcct] = useState<CreateResp | null>(null);
  const [loading, setLoading] = useState<"public" | "private" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  async function create(type: "public" | "private") {
    setLoading(type);
    setErr(null);
    setMissing(false);
    try {
      setAcct(await apiPost<CreateResp>("/api/account", { type }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "WALLET_CLI_MISSING") setMissing(true);
      setErr(errMessage(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-1 text-lg font-semibold">Create wallet account</h2>
      <p className="mb-4 text-xs text-muted">
        Generates a new account via the local LEZ wallet. Keys stay on your machine.
        <span className="text-accent2">
          {" "}
          Private accounts make transfers generate a local ZK proof.
        </span>
      </p>

      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={!!loading}
          onClick={() => create("public")}
        >
          {loading === "public" ? "Creating…" : "New public account"}
        </button>
        <button
          className="btn w-fit bg-accent2 text-white hover:bg-accent2/90"
          disabled={!!loading}
          onClick={() => create("private")}
        >
          {loading === "private" ? "Creating…" : "New private account"}
        </button>
      </div>

      {missing && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
          The <code>wallet</code> CLI isn&apos;t installed. Install it from{" "}
          <code>logos-execution-zone</code> (
          <code>cargo install --path wallet --force</code>) to create accounts and
          send transfers.
        </div>
      )}
      {err && !missing && <p className="mt-3 text-sm text-danger">{err}</p>}

      {acct && (
        <div className="mt-4 rounded-lg border border-border bg-panel2 p-4">
          <div className="label">New account id</div>
          <code className="block break-all text-sm text-ok">
            {acct.accountId ?? "(see raw output)"}
          </code>
          {acct.accountId && (
            <button
              className="btn-ghost mt-3 text-xs"
              onClick={() => navigator.clipboard.writeText(acct.accountId!)}
            >
              Copy id
            </button>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Raw CLI output</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted">
              {acct.raw}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
