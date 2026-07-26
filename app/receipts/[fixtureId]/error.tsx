"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ErrorState } from "@/components/ErrorState";

export default function ReceiptError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
        <ErrorState
          error={error}
          reset={reset}
          title="Couldn't load this receipt"
          description="Something went wrong fetching this settlement's proof. Try again — if it keeps happening, the issue is likely on our end, not yours."
        />
      </div>
      <Footer />
    </div>
  );
}
