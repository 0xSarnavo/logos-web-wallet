import { NextResponse } from "next/server";
import { nodeApi } from "@/lib/node-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [chain, network] = await Promise.all([
      nodeApi.chainInfo(),
      nodeApi.networkInfo(),
    ]);
    return NextResponse.json({ chain, network });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 502 },
    );
  }
}
