"use client";

// Client-side serial operation queue. Mirrors the backend (proofs run one at a
// time): every wallet action (faucet / send / add-private) is enqueued and
// processed strictly one-by-one, so the UI can show a live queue + history.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type TxStatus = "queued" | "running" | "done" | "error";

export interface Tx {
  id: number;
  kind: string; // "Faucet" | "Send" | "Add private"
  privacy: "public" | "private";
  label: string; // human description
  status: TxStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface EnqueueMeta {
  kind: string;
  privacy: "public" | "private";
  label: string;
}

interface QueueItem {
  id: number;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface Ctx {
  txs: Tx[];
  pending: number; // queued + running
  enqueue: (meta: EnqueueMeta, run: () => Promise<unknown>) => Promise<unknown>;
  clearHistory: () => void;
}

const TxCtx = createContext<Ctx | null>(null);

export function TxQueueProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const idRef = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);

  const patch = useCallback((id: number, p: Partial<Tx>) => {
    setTxs((cur) => cur.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const pump = useCallback(() => {
    if (runningRef.current) return;
    const item = queueRef.current.shift();
    if (!item) return;
    runningRef.current = true;
    patch(item.id, { status: "running", startedAt: Date.now() });
    item
      .run()
      .then((v) => {
        patch(item.id, { status: "done", finishedAt: Date.now() });
        item.resolve(v);
      })
      .catch((e) => {
        patch(item.id, {
          status: "error",
          finishedAt: Date.now(),
          error: e instanceof Error ? e.message : String(e),
        });
        item.reject(e);
      })
      .finally(() => {
        runningRef.current = false;
        pump();
      });
  }, [patch]);

  const enqueue = useCallback(
    (meta: EnqueueMeta, run: () => Promise<unknown>) => {
      const id = ++idRef.current;
      setTxs((cur) => [{ id, status: "queued", ...meta }, ...cur]);
      return new Promise((resolve, reject) => {
        queueRef.current.push({ id, run, resolve, reject });
        pump();
      });
    },
    [pump],
  );

  const clearHistory = useCallback(() => {
    setTxs((cur) => cur.filter((t) => t.status === "queued" || t.status === "running"));
  }, []);

  const pending = txs.filter((t) => t.status === "queued" || t.status === "running").length;

  return (
    <TxCtx.Provider value={{ txs, pending, enqueue, clearHistory }}>{children}</TxCtx.Provider>
  );
}

export function useTxQueue(): Ctx {
  const c = useContext(TxCtx);
  if (!c) throw new Error("useTxQueue must be used within TxQueueProvider");
  return c;
}
