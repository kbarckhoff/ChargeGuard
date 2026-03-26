import { createClient } from "@/lib/supabase/server";
import { CDMTable } from "@/components/cdm/CDMTable";
import { EmptyState } from "@/components/ui/shared";
import { FileSpreadsheet } from "lucide-react";

export default async function ChargeMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ audit?: string; page?: string; search?: string; color?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Get the most recent audit (or specific one)
  let auditId = sp.audit;
  if (!auditId) {
    const { data: audits } = await supabase
      .from("audits")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);
    auditId = audits?.[0]?.id;
  }

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#1a1a18]">Charge Master</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            icon={FileSpreadsheet}
            title="No audit selected"
            description="Create an audit first, then import your charge master data."
          />
        </div>
      </>
    );
  }

  const page = parseInt(sp.page || "1");
  const pageSize = 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("charge_items")
    .select("*", { count: "exact" })
    .eq("audit_id", auditId)
    .order("procedure_number");

  if (sp.search) {
    query = query.or(
      `charge_description.ilike.%${sp.search}%,hcpcs_cpt_code.ilike.%${sp.search}%,procedure_number.ilike.%${sp.search}%`
    );
  }
  if (sp.color && sp.color !== "all") {
    query = query.eq("cdm_color", sp.color);
  }

  const { data: items, count } = await query.range(from, to);
  const totalPages = Math.ceil((count || 0) / pageSize);

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Charge Master</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          <CDMTable
            items={items || []}
            total={count || 0}
            page={page}
            totalPages={totalPages}
            search={sp.search || ""}
            colorFilter={sp.color || "all"}
            auditId={auditId}
          />
        </div>
      </div>
    </>
  );
}
