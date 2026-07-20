import { WalletButton } from "@/components/layout/WalletButton";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
        <span className="font-display text-sm font-semibold tracking-wide text-primary">
          VERIFIBET
        </span>
        <WalletButton />
      </nav>
      <main className="p-8 text-muted-foreground">
        Connect a devnet wallet to get started.
      </main>
    </div>
  );
}
