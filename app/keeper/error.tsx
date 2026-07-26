"use client";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ErrorState } from "@/components/ErrorState";

export default function KeeperError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <ErrorState
          error={error}
          reset={reset}
          title="Couldn't load the keeper dashboard"
          description="Something went wrong fetching the operator's status. Try again — if it keeps happening, the issue is likely on our end, not yours."
        />
      </div>
      <Footer />
    </div>
  );
}
