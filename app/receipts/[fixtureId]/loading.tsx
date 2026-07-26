import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReceiptLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <div className="flex justify-center">
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>

      <Footer />
    </div>
  );
}
