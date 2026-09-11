"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Plus, Loader2, ArrowRight, Lock, Building2, DollarSign, CheckCircle2, ClipboardList, ChevronRight, Trash2 } from "lucide-react";

interface Run {
  id: string;
  name: string;
  hospital_name: string;
  created_at: string;
  status: string;
  period_year: number | null;
  period_quarter: number | null;
  chargeItems: number;
  openFindings: number;
  resolvedFindings: number;
  criticalOpen: number;
  impact: number;
  captured: number;
  peerCount: number;
  lastScanned: string | null;
}
interface Kpis { opportunityFound: number; captured: number; runCount: number }

function money(n: number) {
  if (!n || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function periodLabel(r: Run) {
  // Only real quarter runs get a Q# label. Legacy/test records with no period
  // are shown honestly as "Unscheduled" rather than a made-up quarter.
  if (r.period_year && r.period_quarter) return `Q${r.period_quarter} ${r.period_year}`;
  return "Unscheduled";
}

export function RunsHome({ runs, kpis, hospitalName }: {
  runs: Run[]; kpis: Kpis; currentQuarter?: { q: number; y: number }; hospitalName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Entity is fixed once for the instance; prefill and lock it.
  const [hospital, setHospital] = useState(hospitalName ?? "");
  const [reviewName, setReviewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const hospitalFixed = !!hospitalName;

  const deleteRun = async (id: string, label: string) => {
    if (!confirm(`Delete the ${label} run and all of its data? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/audits/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId: id }) });
      if (res.ok) router.refresh();
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  // Reviews can be started any time, any quarter, as many times as needed
  // (flat quarterly pricing, unlimited runs).
  const startReview = async () => {
    const entity = (hospitalName ?? hospital).trim();
    const name = reviewName.trim();
    if (!entity || !name) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/audits/start-quarter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospital_name: entity, name }),
      });
      const j = await res.json();
      if (!res.ok || !j.auditId) { setErr(j.error || "Could not start the review"); return; }
      router.push(`/assessment?auditId=${j.auditId}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const canStart = (hospitalName ?? hospital).trim().length > 0 && reviewName.trim().length > 0;

  const kpi = (label: string, value: string | number, Icon: any, color: string, tint: string) => (
    <div className="bg-white rounded-xl border border-[#e6e9f2] p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[#64748b]">{label}</span>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: tint }}><Icon size={16} style={{ color }} /></span>
      </div>
      <div className="text-[22px] font-bold text-[#0f172a] mt-2">{value}</div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 min-w-0 bg-[#f4f6f8]">
        {/* header */}
        <div className="bg-white border-b border-[#e6e9f2] px-8 py-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-[#0f172a]">CDM review runs</h1>
            <p className="text-[13px] text-[#64748b] mt-0.5 flex items-center gap-1.5">
              {hospitalName
                ? <><Building2 size={14} className="text-[#2563eb]" /> {hospitalName}</>
                : "Start your first CDM review below."}
            </p>
          </div>
          <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2563eb] text-white text-sm font-semibold hover:bg-[#1d4ed8]">
            <Plus size={16} /> Start review
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-8 py-6 space-y-6">
          {/* Start review panel — fixed hospital, pick quarter + year */}
          {open && (
            <div className="bg-white rounded-xl border border-[#e6e9f2] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="text-[13px] font-semibold text-[#0f172a] mb-1">Start a review</div>
              <p className="text-xs text-[#94a3b8] mb-3">Name the review and start. There's no limit on how many reviews you run.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">Entity</label>
                  {hospitalFixed ? (
                    <div className="w-full h-10 border border-[#e2e6ec] rounded-lg px-3 text-[13px] flex items-center gap-2 bg-[#f8fafc] text-[#334155]">
                      <Lock size={13} className="text-[#94a3b8]" /> {hospitalName}
                    </div>
                  ) : (
                    <input value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="Entity name" className="w-full h-10 border border-[#e2e6ec] rounded-lg px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">Review name</label>
                  <input value={reviewName} onChange={(e) => setReviewName(e.target.value)} placeholder="e.g. Q3 2026 CDM Review" className="w-full h-10 border border-[#e2e6ec] rounded-lg px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20" />
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <button onClick={startReview} disabled={busy || !canStart} className="flex items-center gap-2 px-4 h-10 rounded-lg bg-[#2563eb] text-white text-sm font-semibold hover:bg-[#1d4ed8] disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Start &amp; go to Intake
                </button>
              </div>
              {err && <div className="text-xs text-[#b42318] mt-2">{err}</div>}
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {kpi("$ opportunity found", money(kpis.opportunityFound), DollarSign, "#059669", "#e7f7ef")}
            {kpi("$ captured", money(kpis.captured), CheckCircle2, "#2563eb", "#eff4ff")}
            {kpi("CDM runs", kpis.runCount.toLocaleString(), ClipboardList, "#7c3aed", "#f3effe")}
          </div>

          {/* Runs — flat, most recent first */}
          {runs.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#e6e9f2] p-10 text-center">
              <p className="text-[#64748b] mb-4">No reviews yet.</p>
              <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2563eb] text-white text-sm font-semibold hover:bg-[#1d4ed8]"><Plus size={16} /> Start a review</button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#e6e9f2] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#eef1f5]">
                <span className="text-[13px] font-semibold text-[#0f172a]">Reviews</span>
                <span className="text-[12px] text-[#94a3b8] ml-2">· {runs.length} {runs.length === 1 ? "run" : "runs"}</span>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[#fbfcfe] text-[#9aa2af]">
                    {["Name", "Status", "Lines", "Open", "Critical", "$ impact", "Last scanned", ""].map((h) => (
                      <th key={h} className="text-left text-[11px] uppercase tracking-wide px-5 py-2.5 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} data-audit-id={r.id} onClick={() => router.push(`/findings?auditId=${r.id}`)} className="border-t border-[#f1f4f9] hover:bg-[#f8fafc] cursor-pointer">
                      <td className="px-5 py-3 font-semibold text-[#0f172a]">{r.name || periodLabel(r)}</td>
                      <td className="px-5 py-3">
                        {r.status === "completed"
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#475569] bg-[#eef1f5] px-2.5 py-1 rounded-full"><Lock size={11} /> Completed</span>
                          : r.peerCount > 0
                            ? <span className="text-[11px] font-semibold text-[#067647] bg-[#e7f7ef] px-2.5 py-1 rounded-full">Ready</span>
                            : <span className="text-[11px] font-semibold text-[#b45309] bg-[#fef4e2] px-2.5 py-1 rounded-full">Under Review</span>}
                      </td>
                      <td className="px-5 py-3 text-[#475569]">{r.chargeItems.toLocaleString()}</td>
                      <td className="px-5 py-3 text-[#475569]">{r.openFindings.toLocaleString()}</td>
                      <td className="px-5 py-3">{r.criticalOpen > 0 ? <span className="text-[#b42318] font-semibold">{r.criticalOpen}</span> : <span className="text-[#94a3b8]">0</span>}</td>
                      <td className="px-5 py-3 font-semibold text-[#0f172a]">{money(r.impact)}</td>
                      <td className="px-5 py-3 text-[#94a3b8]">{r.lastScanned ? new Date(r.lastScanned).toLocaleDateString() : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={(e) => { e.stopPropagation(); deleteRun(r.id, periodLabel(r)); }} disabled={deleting === r.id} title="Delete run" className="p-1.5 rounded-md text-[#c5cbd3] hover:text-[#b42318] hover:bg-[#fdeceb] disabled:opacity-50">
                            {deleting === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                          <ChevronRight size={15} className="text-[#c5cbd3]" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
