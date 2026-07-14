import { WalletButton } from "@/components/layout/WalletButton";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
        <span className="font-[family-name:var(--font-geist-mono)] text-sm font-semibold tracking-wide text-emerald-400">
          VERIFIBET
        </span>
        <WalletButton />
      </nav>
      <main className="p-8 font-[family-name:var(--font-geist-sans)] text-slate-400">
        Connect a devnet wallet to get started.
      </main>
    </div>
  );
}
