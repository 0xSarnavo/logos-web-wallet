"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiPost, ApiError, errMessage } from "@/lib/client";

export function ReceiveCard() {
  const [addr, setAddr] = useState("");
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const [faucetErr, setFaucetErr] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (addr.trim() && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, addr.trim(), {
        width: 180,
        margin: 1,
        color: { dark: "#ffffff", light: "#13151c" },
      }).catch(() => {});
    }
  }, [addr]);

  async function claim() {
    setClaiming(true);
    setFaucetErr(null);
    setFaucetMsg(null);
    try {
      const r = await apiPost<{ raw: string }>("/api/faucet", { to: addr.trim() });
      setFaucetMsg(r.raw || "Faucet claim submitted.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "WALLET_CLI_MISSING") {
        setFaucetErr("Faucet needs the `wallet` CLI installed.");
      } else {
        setFaucetErr(errMessage(e));
      }
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-1 text-lg font-semibold">Receive</h2>
      <p className="mb-4 text-xs text-muted">
        Share this account id (or QR) to receive funds. Use the faucet to seed a
        fresh account on a local network.
      </p>

      <label className="label">Your account id</label>
      <input
        className="input mb-4"
        placeholder="Public/…"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
      />

      {addr.trim() && (
        <div className="flex flex-col items-center gap-3">
          <canvas
            ref={canvasRef}
            className="rounded-lg border border-border bg-panel2 p-2"
          />
          <button
            className="btn-ghost text-xs"
            onClick={() => navigator.clipboard.writeText(addr.trim())}
          >
            Copy address
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <button
          className="btn-ghost w-full"
          disabled={!addr.trim() || claiming}
          onClick={claim}
        >
          {claiming ? "Claiming…" : "💧 Claim from faucet"}
        </button>
        {faucetErr && <p className="mt-2 text-xs text-danger">{faucetErr}</p>}
        {faucetMsg && (
          <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-ok">
            {faucetMsg}
          </pre>
        )}
      </div>
    </div>
  );
}
