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
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Audits</h1>
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
                  className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#e5e5e0] hover:shadow-sm transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-[#1a1a18]">{audit.hospital_name}</span>
                      <Badge variant={STATUS_BADGE[audit.status] || "default"}>
                        {audit.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="text-sm text-[#5a5a55]">{audit.name}</div>
                    <div className="text-xs text-[#9a9a95] mt-1">
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
