import { Loader2 } from "lucide-react";

// Instant skeleton shown by App Router the moment a nav link is clicked, while
// the destination page renders on the server. Makes menu navigation feel snappy.
export function RouteLoading({ title }: { title?: string }) {
  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center flex-shrink-0">
        <div className="h-4 w-40 rounded bg-[#eef2f7]" />
        {title ? <span className="sr-only">{title}</span> : null}
      </header>
      <div className="flex-1 flex items-center justify-center text-[#94a3b8]">
        <Loader2 size={22} className="animate-spin" />
      </div>
    </>
  );
}
