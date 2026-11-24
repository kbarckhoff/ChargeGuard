import { ChevronDown, BookOpen } from "lucide-react";
import { BUCKET_LABELS, BUCKET_INPUT, type FindingBucket } from "@/lib/finding-buckets";
import { TAB_REASONING } from "@/lib/tab-reasoning";

const TIER_LABEL: Record<string, string> = { R: "Rapid", F: "Full", M: "Remediation", "R/F": "Rapid / Full" };

/** Collapsible "Rules and reasoning" panel for a Findings tab: which rules feed
 *  the tab, what each tests, and why it is in the report. */
export function TabReasoningPanel({ tab, defaultOpen = false }: { tab: FindingBucket; defaultOpen?: boolean }) {
  const r = TAB_REASONING[tab];
  if (!r) return null;
  const pending = r.rules.filter((x) => x.validated === false).length;
  return (
    <details open={defaultOpen} className="group bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
      <summary className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-[#f8fafc]">
        <div className="flex items-start gap-2.5 min-w-0">
          <BookOpen size={15} className="text-[#197ff9] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Rules and reasoning: {BUCKET_LABELS[tab]}</h3>
            <p className="text-[12px] text-[#64748b] mt-0.5">{r.rules.length} {r.rules.length === 1 ? "rule family feeds" : "rule families feed"} this tab · Source: {r.input}{pending > 0 ? ` · ${pending} pending source validation` : ""}</p>
          </div>
        </div>
        <ChevronDown size={14} className="text-[#94a3b8] shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#eef2f7] px-5 py-4 space-y-3">
        <p className="text-[12.5px] text-[#334155]"><span className="font-semibold text-[#0f172a]">Why this tab exists. </span>{r.purpose}</p>
        <p className="text-[12px] text-[#64748b]">{r.contract}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#f1f5f9]">
                <th className="py-2 pr-3 w-20">Rule</th><th className="py-2 pr-3 w-52">Name</th><th className="py-2 pr-3">What it tests</th><th className="py-2 pr-3">Why it is in the report</th><th className="py-2 w-24">Tier</th>
              </tr>
            </thead>
            <tbody>
              {r.rules.map((x) => (
                <tr key={x.ref + x.name} className="border-b border-[#f6f8fa] align-top">
                  <td className="py-2.5 pr-3 font-mono text-[11.5px] text-[#475569] whitespace-nowrap">{x.ref}</td>
                  <td className="py-2.5 pr-3 font-medium text-[#0f172a]">
                    {x.name}
                    {x.validated === false && <span className="ml-1.5 inline-block text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded align-middle" title="Code relationships written from public coding knowledge; confirm against current CMS and CPT/HCPCS sources before relying on it.">VALIDATE</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-[#334155]">{x.tests}</td>
                  <td className="py-2.5 pr-3 text-[#475569]">{x.why}</td>
                  <td className="py-2.5 text-[#64748b] whitespace-nowrap">{TIER_LABEL[x.tier] || x.tier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/** Shown when a tab has no findings, so a blank tab reads as "input not supplied
 *  or nothing fired", not as a broken page. */
export function TabEmptyState({ tab, auditId }: { tab: FindingBucket; auditId: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-[#cbd5e1] px-6 py-8 text-center">
      <h3 className="text-[14px] font-semibold text-[#0f172a]">Nothing on the {BUCKET_LABELS[tab]} tab for this review</h3>
      <p className="text-[12.5px] text-[#64748b] mt-1.5 max-w-xl mx-auto">
        This tab is fed by the {BUCKET_INPUT[tab]}. If that file has not been imported for this review, the rules behind this tab did not run. If it was imported, none of them fired.
      </p>
      <a href={`/assessment?auditId=${auditId}`} className="inline-block mt-4 px-3.5 py-2 rounded-lg bg-[#197ff9] text-white text-[12.5px] font-semibold hover:bg-[#0a6cff]">Open imports</a>
    </div>
  );
}
