"use client";

import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export function WalletButton() {
  return (
    <WalletMultiButtonDynamic className="!h-9 !rounded-md !border !border-emerald-500/30 !bg-slate-800 !px-4 !font-sans !text-sm !font-medium !text-emerald-300 !shadow-none hover:!bg-slate-700 hover:!text-emerald-200" />
  );
}
