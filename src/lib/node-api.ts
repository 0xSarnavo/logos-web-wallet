// Read-only client for the Logos node HTTP API.
// Endpoints confirmed working against a live node (run-local-logos-node recipe):
//   GET /cryptarchia/info            → { height, slot, lib_slot, lib, tip, mode }
//   GET /network/info                → { peer_id, n_peers, n_connections, listen_addresses }
//   GET /wallet/{key}/balance        → { tip, balance, notes: { <noteId>: <value> } }
// Other endpoints (mempool, block-by-hash, ws) are NOT exposed — don't depend on them.

import { config } from "./config";

export interface ChainInfo {
  lib: string;
  lib_slot: number;
  tip: string;
  slot: number;
  height: number;
  mode: string;
}

export interface NetworkInfo {
  listen_addresses: string[];
  peer_id: string;
  n_peers: number;
  n_connections: number;
  n_pending_connections: number;
}

export interface BalanceResult {
  tip: string;
  balance: number;
  /** Map of UTXO note id → value. The wallet's spendable notes. */
  notes: Record<string, number>;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.nodeApi}${path}`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NodeApiError(res.status, body || res.statusText, path);
  }
  return res.json() as Promise<T>;
}

export class NodeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`node API ${status} on ${path}: ${body}`);
    this.name = "NodeApiError";
  }
}

export const nodeApi = {
  chainInfo: (signal?: AbortSignal) =>
    getJson<ChainInfo>("/cryptarchia/info", signal),

  networkInfo: (signal?: AbortSignal) =>
    getJson<NetworkInfo>("/network/info", signal),

  /**
   * Balance for a 64-hex PUBLIC account key. The node returns a plain-text
   * "could not be found" (not JSON) for unknown keys, so callers should treat a
   * NodeApiError 404/400 as "zero / not yet on chain".
   */
  balance: (publicKey: string, signal?: AbortSignal) =>
    getJson<BalanceResult>(
      `/wallet/${encodeURIComponent(publicKey)}/balance`,
      signal,
    ),
};

/** Convenience: returns balance, or a zeroed result when the key is unknown. */
export async function balanceOrZero(
  publicKey: string,
  signal?: AbortSignal,
): Promise<BalanceResult & { known: boolean }> {
  try {
    const r = await nodeApi.balance(publicKey, signal);
    return { ...r, known: true };
  } catch (e) {
    if (e instanceof NodeApiError) {
      return { tip: "", balance: 0, notes: {}, known: false };
    }
    throw e;
  }
}
