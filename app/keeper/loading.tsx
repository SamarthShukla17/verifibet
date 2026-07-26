import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Skeleton } from "@/components/ui/skeleton";

export default function KeeperLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-80" />

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>

        <Skeleton className="mt-6 h-24 w-full rounded-xl" />
        <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      </div>

      <Footer />
    </div>
  );
}
