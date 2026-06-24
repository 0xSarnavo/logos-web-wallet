// Read-only JSON-RPC client for the LEZ sequencer. Server-only.
//
// LEZ account balances live in the sequencer, NOT the Logos node's
// /wallet/{key}/balance (that endpoint is for the node's own wallet and rejects
// LEZ account keys). The sequencer answers getAccount by base58 account id with
// no auth, so balance reads need no password.
import { config } from "./config";

export interface AccountData {
  balance: number;
  nonce: number;
  /** true when the account exists on-chain (initialized). */
  exists: boolean;
}

/** Strip a "Public/" or "Private/" privacy prefix to the raw base58 id. */
export function bareAccountId(accountId: string): string {
  return accountId.replace(/^(Public|Private)\//i, "");
}

export async function getAccount(
  accountId: string,
  signal?: AbortSignal,
): Promise<AccountData> {
  const id = bareAccountId(accountId);
  const url = config.sequencerApi.endsWith("/")
    ? config.sequencerApi
    : config.sequencerApi + "/";

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccount", params: [id] }),
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`sequencer ${res.status}`);

  const json = await res.json();
  // Unknown/uninitialized accounts come back as an error or null result.
  if (json.error || json.result == null) {
    return { balance: 0, nonce: 0, exists: false };
  }
  const r = json.result;
  return {
    balance: Number(r.balance ?? 0),
    nonce: Number(r.nonce ?? 0),
    exists: true,
  };
}
