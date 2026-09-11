import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui/shared";
import { NewAuditDialog } from "@/components/audit/NewAuditDialog";
import { ClipboardCheck, ChevronRight } from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  draft: "default",
  in_progress: "info",
  on_hold: "warning",
  completed: "success",
  archived: "default",
};

export default async function AuditsPage() {
  const supabase = await createClient();
  const { data: audits } = await supabase
    .from("audits")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Audits</h1>
        <NewAuditDialog />
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {!audits || audits.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No audits yet"
              description="Create your first CDM audit to begin the comprehensive review process."
              action={<NewAuditDialog />}
            />
          ) : (
            <div className="space-y-2">
              {audits.map((audit) => (
                <Link
                  key={audit.id}
                  href={`/audits/${audit.id}`}
                  className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#e2e8f0] hover:shadow-sm transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-[#0f172a]">{audit.hospital_name}</span>
                      <Badge variant={STATUS_BADGE[audit.status] || "default"}>
                        {audit.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="text-sm text-[#475569]">{audit.name}</div>
                    <div className="text-xs text-[#94a3b8] mt-1">
                      {audit.total_charge_items?.toLocaleString() || 0} charge items •{" "}
                      {audit.total_findings || 0} findings •{" "}
                      Started {audit.start_date ? new Date(audit.start_date).toLocaleDateString() : "Not set"}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[#c5c5c0]" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
