"use client";

import { useRouter } from "next/navigation";

// Header control on the Findings & Analysis page: switch which review's findings
// you're viewing, and jump to that review's peer analysis / report.
export function ReviewPicker({ runs, auditId }: { runs: { id: string; name: string }[]; auditId: string }) {
  const router = useRouter();
  if (!runs.length) return null;
  return (
    <div className="flex items-center gap-2">
      <select
        value={auditId}
        onChange={(e) => router.push(`/findings?auditId=${e.target.value}`)}
        className="h-8 border border-[#e2e8f0] rounded-lg px-2 text-[13px] bg-white max-w-[220px] focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20"
      >
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </div>
  );
}
