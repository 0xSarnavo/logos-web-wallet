import { StatusBar } from "@/components/StatusBar";
import { BalanceCard } from "@/components/BalanceCard";
import { AccountCard } from "@/components/AccountCard";
import { TransferCard } from "@/components/TransferCard";
import { ReceiveCard } from "@/components/ReceiveCard";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Logos <span className="text-accent">Wallet</span>
            </h1>
            <p className="text-xs text-muted">
              Logos Execution Zone · native token · local proof generation
            </p>
          </div>
        </div>
        <div className="mt-4">
          <StatusBar />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <BalanceCard />
        <AccountCard />
        <TransferCard />
        <ReceiveCard />
      </div>

      <footer className="mt-8 rounded-xl border border-accent2/30 bg-accent2/5 p-4 text-xs text-muted">
        <span className="font-semibold text-accent2">Architecture A (this app):</span>{" "}
        the browser UI talks to local API routes that read the node and drive the
        LEZ <code>wallet</code> CLI. Proofs for private transfers are generated on
        your machine, not in the browser.{" "}
        <span className="text-accent2">Track C</span> (in-browser WASM proving) is
        under research — see <code>docs/RESEARCH-C-browser-proving.md</code>.
      </footer>
    </main>
  );
}
