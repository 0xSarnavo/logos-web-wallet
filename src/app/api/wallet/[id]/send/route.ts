import { NextRequest, NextResponse } from "next/server";
import { getWalletRow, updateSealedStorage } from "@/lib/wallet-store";
import { runForWallet, EngineError } from "@/lib/wallet-engine";
import { assertSafeMention, MentionError, isPrivateAccount } from "@/lib/wallet-cli";
import { audit } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getAccount } from "@/lib/sequencer-rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const STATUS: Record<EngineError["code"], number> = {
  BAD_PASSWORD: 401,
  WALLET_CLI_MISSING: 503,
  TIMEOUT: 504,
  CLI_FAILED: 502,
};

// POST /api/wallet/[id]/send { from: "public"|"private", to, amount, password }
// Privacy (proof) is inferred from the accounts involved.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const wallet = await getWalletRow(params.id);
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });

  const rl = rateLimit(`send:${wallet.id}`, 20, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many sends, slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let fromWhich = "public";
  let to = "";
  let toNpk = "";
  let toVpk = "";
  let amount: unknown;
  let password = "";
  try {
    const body = await req.json();
    fromWhich = body?.from === "private" ? "private" : "public";
    to = String(body?.to ?? "");
    toNpk = String(body?.toNpk ?? "");
    toVpk = String(body?.toVpk ?? "");
    amount = body?.amount;
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive integer" }, { status: 400 });
  }
  if (!password) return NextResponse.json({ error: "password is required" }, { status: 400 });
  if (fromWhich === "private" && !wallet.privateAccountId) {
    return NextResponse.json({ error: "wallet has no private account yet" }, { status: 400 });
  }
  const from = fromWhich === "private" ? wallet.privateAccountId! : wallet.publicAccountId;

  // Two recipient modes: by account id (--to), or to a FOREIGN private account via
  // its shared viewing keys (--to-npk/--to-vpk).
  const useKeys = Boolean(toNpk && toVpk);
  let sendArgs: string[];
  let isPrivate: boolean;
  if (useKeys) {
    if (!/^[0-9a-fA-F]{64}$/.test(toNpk) || !/^[0-9a-fA-F]{66}$/.test(toVpk)) {
      return NextResponse.json({ error: "invalid recipient keys (npk/vpk)" }, { status: 400 });
    }
    sendArgs = ["auth-transfer", "send", "--from", from, "--to-npk", toNpk, "--to-vpk", toVpk, "--amount", String(amount)];
    isPrivate = true; // sending to a private account → proof
  } else {
    let safeTo: string;
    try {
      safeTo = assertSafeMention(to);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof MentionError ? e.message : "invalid recipient" },
        { status: 400 },
      );
    }
    sendArgs = ["auth-transfer", "send", "--from", from, "--to", safeTo, "--amount", String(amount)];
    isPrivate = isPrivateAccount(from) || isPrivateAccount(safeTo);
  }

  // For a PUBLIC source we can verify the send actually settled on-chain: the
  // source nonce must increment. (A mock sequencer accepts shielded txs without
  // settling — this catches that so we never falsely report success.)
  const nonceBefore =
    fromWhich === "public" ? await getAccount(from).then((a) => a.nonce).catch(() => null) : null;

  try {
    const { stdout, sealedStorage } = await runForWallet(
      password,
      wallet.kdfSalt,
      wallet.sealedStorage,
      wallet.sealedCliPw,
      sendArgs,
      { proof: isPrivate },
    );
    await updateSealedStorage(wallet.id, sealedStorage);

    if (nonceBefore !== null) {
      const after = await getAccount(from).then((a) => a.nonce).catch(() => nonceBefore);
      if (after <= nonceBefore) {
        await audit(wallet.id, "send", false, "NOT_SETTLED");
        return NextResponse.json(
          {
            error:
              "Submitted, but the transfer did not settle on-chain. This node likely " +
              "doesn't support shielded settlement (mock/standalone sequencer).",
            code: "NOT_SETTLED",
            raw: stdout.trim(),
          },
          { status: 502 },
        );
      }
    }

    await audit(wallet.id, isPrivate ? "send_private" : "send_public", true);
    return NextResponse.json({ ok: true, private: isPrivate, raw: stdout.trim() });
  } catch (e) {
    if (e instanceof EngineError) {
      await audit(wallet.id, "send", false, e.code);
      return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
