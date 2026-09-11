import { referenceCoverage } from "@/lib/cms-reference";
import { allSourceStatus, nextRelease, type SourceStatus } from "@/lib/reference-sources";
import { createClient } from "@supabase/supabase-js";
import { Database, Layers, Stethoscope, FlaskConical, Pill, Archive, ShieldCheck, CalendarClock, Syringe, FileText, AlertTriangle, CheckCircle2, Lock, RefreshCw } from "lucide-react";

const ICONS: Record<string, any> = {
  addendum_b: Layers, addendum_a: Database, mpfs: Stethoscope, clfs: FlaskConical,
  asp: Pill, hcpcs: Archive, vaccine: Syringe, cpt: FileText,
};

const DESC: Record<string, string> = {
  addendum_b: "Payment status per HCPCS (bundled, packaged, separately payable, pass-through). Drives which lines are eligible for repricing.",
  addendum_a: "Ambulatory Payment Classification rates. The outpatient benchmark for the Medicare markup band.",
  mpfs: "Non-facility and facility fees plus RVUs. Used where a service is priced off the professional fee schedule.",
  clfs: "Medicare lab pricing. The CLFS-first benchmark for every laboratory CDM line.",
  asp: "Average Sales Price payment limits and billing units. Benchmarks drug and biological lines and their dosing.",
  hcpcs: "New, revised, and deleted HCPCS codes. Drives the retired-code flags so deleted codes get replaced.",
  vaccine: "Locality-adjusted vaccine administration rates (G0008/G0009/G0010/M0201).",
  cpt: "AMA CPT descriptions and annual code changes. Licensed content, supplied manually each year.",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// Benchmarks = the public CMS reference data ChargeGuard prices every CDM line
// against, with each source's update cadence and whether a newer release is due.
export default async function BenchmarksPage() {
  const cov = referenceCoverage();
  const countByKey: Record<string, number | null> = {
    addendum_b: cov.si, addendum_a: cov.apc, mpfs: cov.mpfs, clfs: cov.clfs,
    asp: cov.asp, hcpcs: cov.retired, vaccine: null, cpt: null,
  };
  const sources = allSourceStatus();
  const overdueCount = sources.filter((s) => s.overdue).length;

  // Live refresh status from the metadata table the refresh job writes to.
  type RefreshMeta = { status?: string; last_refreshed?: string; last_error?: string | null; row_count?: number; vintage?: string };
  const refreshByKey: Record<string, RefreshMeta> = {};
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await db.from("cms_reference_sources").select("key, status, last_refreshed, last_error, row_count, vintage");
    for (const r of data || []) refreshByKey[r.key as string] = r;
  } catch { /* table may not exist yet — page still renders from the static registry */ }

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">References</h1>
        <span className="text-sm text-[#94a3b8]">{cov.total.toLocaleString()} reference codes</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="bg-white rounded-xl border border-[#e2e8f0] p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#eff4ff] flex items-center justify-center shrink-0"><ShieldCheck size={19} className="text-[#2563eb]" /></div>
            <div>
              <h2 className="text-sm font-semibold text-[#0f172a]">CMS reference data</h2>
              <p className="text-[13px] text-[#64748b] mt-1">
                Every priced CDM line is benchmarked against these public CMS fee schedules. {overdueCount > 0 ? `${overdueCount} ${overdueCount === 1 ? "source has" : "sources have"} a newer release available.` : "All sources are current."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sources.map((s: SourceStatus) => {
              const Icon = ICONS[s.key] || Database;
              const count = countByKey[s.key];
              // Prefer the live refresh metadata: once the job has actually pulled
              // a release, drive "loaded" + "update due" from when it last ran,
              // instead of the static bundled vintage.
              const meta = refreshByKey[s.key];
              let vintage = s.vintage, overdue = s.overdue, nextDue = s.nextDue;
              if (meta?.last_refreshed && s.cadence !== "manual") {
                const eff = new Date(meta.last_refreshed);
                nextDue = nextRelease(s.cadence, eff);
                overdue = nextDue != null && Date.now() >= nextDue.getTime();
                if (meta.vintage) vintage = meta.vintage;
              }
              return (
                <div key={s.key} className="bg-white rounded-xl border border-[#e2e8f0] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-[#f1f5f9] flex items-center justify-center"><Icon size={17} className="text-[#475569]" /></div>
                      <div>
                        <div className="text-[13.5px] font-semibold text-[#0f172a] leading-tight">{s.name}</div>
                        <div className="text-[11px] text-[#94a3b8] uppercase tracking-wide">{s.abbr}</div>
                      </div>
                    </div>
                    {count != null && (
                      <div className="text-right">
                        <div className="text-[20px] font-bold text-[#0f172a] leading-none">{count.toLocaleString()}</div>
                        <div className="text-[11px] text-[#94a3b8] mt-1">codes</div>
                      </div>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[#64748b] mt-3 leading-snug">{DESC[s.key]}</p>

                  {(() => {
                    const m = refreshByKey[s.key];
                    if (!m) return null;
                    const when = m.last_refreshed ? fmtDate(new Date(m.last_refreshed)) : "—";
                    return (
                      <div className="mt-3 text-[11px]">
                        {m.status === "error" ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#b42318] bg-[#fdeceb] px-2 py-0.5 rounded" title={m.last_error || ""}><AlertTriangle size={11} /> Last refresh failed{m.last_error ? `: ${m.last_error.slice(0, 60)}` : ""}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-[#067647] bg-[#e7f7ef] px-2 py-0.5 rounded"><RefreshCw size={11} /> Auto-refreshed {when}{m.row_count ? ` · ${m.row_count.toLocaleString()} rows` : ""}</span>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex items-center flex-wrap gap-2 mt-3 pt-3 border-t border-[#f1f5f9]">
                    {s.cadence === "manual" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8a5a1a] bg-[#fef4e6] px-2 py-0.5 rounded"><Lock size={11} /> Manual (licensed)</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#475569] bg-[#f1f5f9] px-2 py-0.5 rounded capitalize"><CalendarClock size={11} /> {s.cadence}</span>
                    )}
                    <span className="text-[11px] text-[#94a3b8]">Loaded: {vintage}</span>
                    {s.cadence !== "manual" && (
                      overdue ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b42318] bg-[#fdeceb] px-2 py-0.5 rounded"><AlertTriangle size={11} /> Update due ({fmtDate(nextDue)})</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#067647] bg-[#e7f7ef] px-2 py-0.5 rounded"><CheckCircle2 size={11} /> Current · next {fmtDate(nextDue)}</span>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </>
  );
}
