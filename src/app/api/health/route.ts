import { NextResponse } from "next/server";
import { nodeApi } from "@/lib/node-api";
import { walletCli } from "@/lib/wallet-cli";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// One-stop status: is the node reachable, and is the wallet backend usable?
export async function GET() {
  const [node, cli] = await Promise.allSettled([
    nodeApi.chainInfo(),
    walletCli.available(),
  ]);

  return NextResponse.json({
    node:
      node.status === "fulfilled"
        ? { reachable: true, height: node.value.height, mode: node.value.mode }
        : { reachable: false, error: String(node.reason) },
    walletBackend: config.walletBackend,
    walletCli:
      cli.status === "fulfilled"
        ? { available: cli.value }
        : { available: false },
    proofTimeoutSeconds: config.proofTimeoutSeconds,
  });
}
