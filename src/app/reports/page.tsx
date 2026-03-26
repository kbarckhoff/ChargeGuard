import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState } from "@/components/ui/shared";
import { PieChart, FileText, Download, Plus } from "lucide-react";

export default async function ReportsPage() {
  const supabase = await createClient();

  const { data: audits } = await supabase.from("audits").select("id").order("created_at", { ascending: false }).limit(1);
  const auditId = audits?.[0]?.id;

  const { data: reports } = auditId
    ? await supabase.from("reports").select("*").eq("audit_id", auditId).order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Reports — Phase VII</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a]">
          <Plus size={15} /> New Report
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Report Builder */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
            <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Report Builder</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="text-xs font-medium text-[#7a7a75] block mb-1">Format</label>
                <select className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
                  <option>PDF</option><option>Excel</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a7a75] block mb-1">View</label>
                <select className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
                  <option>Summary</option><option>Detail</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#7a7a75] block mb-1">Sort By</label>
                <select className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
                  <option>HCPCS/CPT Code</option><option>Procedure Code</option><option>Gross Revenue</option><option>Description</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {["Phase I Findings", "Compliance Issues", "Pricing Below Benchmark", "Missing Charges", "Modifier Errors", "Claim Corrections", "Department Actions", "All Findings"].map((f, i) => (
                <label key={i} className="flex items-center gap-2 text-sm text-[#5a5a55] cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 3} className="rounded border-[#d5d5d0]" /> {f}
                </label>
              ))}
            </div>
            <button className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a]">
              <Download size={15} /> Generate Report
            </button>
          </div>

          {/* Generated Reports */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
            <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Generated Reports</h3>
            {(!reports || reports.length === 0) ? (
              <p className="text-sm text-[#9a9a95] py-8 text-center">No reports generated yet. Use the builder above to create your first report.</p>
            ) : (
              <div className="space-y-2">
                {reports.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-[#e5e5e0] hover:bg-[#fafaf8]">
                    <div className="w-9 h-9 rounded-lg bg-[#f5f5f0] flex items-center justify-center">
                      <FileText size={16} className="text-[#5a5a55]" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#3d3d3a]">{r.title}</div>
                      <div className="text-xs text-[#9a9a95]">
                        {new Date(r.created_at).toLocaleDateString()} • {r.report_format.toUpperCase()} • {r.report_view}
                      </div>
                    </div>
                    <button className="p-2 hover:bg-[#f0f0ec] rounded-lg"><Download size={15} className="text-[#7a7a75]" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
