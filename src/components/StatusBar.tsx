"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";

interface Health {
  node: { reachable: boolean; height?: number; mode?: string };
  walletBackend: string;
  walletCli: { available: boolean };
  proofTimeoutSeconds: number;
}

export function StatusBar() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const tick = () =>
      apiGet<Health>("/api/health")
        .then((d) => live && (setH(d), setErr(null)))
        .catch((e) => live && setErr(String(e.message)));
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const dot = (ok: boolean) =>
    ok ? "bg-ok" : "bg-danger";

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="pill bg-panel2">
        <span className={`h-2 w-2 rounded-full ${dot(!!h?.node.reachable)}`} />
        Node{" "}
        {h?.node.reachable
          ? `· ${h.node.mode} · #${h.node.height?.toLocaleString()}`
          : "· offline"}
      </span>
      <span className="pill bg-panel2">
        <span className={`h-2 w-2 rounded-full ${dot(!!h?.walletCli.available)}`} />
        Wallet CLI {h?.walletCli.available ? "· ready" : "· missing"}
      </span>
      {h && (
        <span className="pill bg-panel2">
          backend: {h.walletBackend} · proof timeout {h.proofTimeoutSeconds}s
        </span>
      )}
      {err && <span className="text-danger">health: {err}</span>}
    </div>
  );
}
