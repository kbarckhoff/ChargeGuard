"use client";

import { useState, useRef, useEffect, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ClipboardList, Upload, FileSearch, Users, BarChart3, Check,
  FileSpreadsheet, Database, Pill, Download, DollarSign, FileText,
  AlertTriangle, ListChecks, Zap, Lock, Plus, X, Loader2, Trash2, LogOut, Building2, ArrowRight,
} from "lucide-react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { parseMrf, splitCsvLine, extractCsvRow, previewCsv, aggregate } from "@/lib/mrf-parser";

interface StreamOpts { headerLineIndex: number; codeIdx: number; typeIdx: number; grossIdx: number; method: string }

// Stream a large CSV MRF line-by-line (300MB+ never loads into memory), using
// the column config the user confirmed, and aggregate the distinct gross prices
// per code by the chosen method.
async function streamCsvFile(file: File, opts: StreamOpts, onProgress: (codes: number) => void): Promise<{ rows: { hcpcs: string; gross: number }[] }> {
  const reader = (file.stream() as any).pipeThrough(new TextDecoderStream()).getReader();
  const cfg = { grossIdx: opts.grossIdx, codeCols: [{ ci: opts.codeIdx, ti: opts.typeIdx, direct: opts.typeIdx < 0 }] };
  const acc = new Map<string, Set<number>>();
  let buffer = "", idx = -1, lc = 0;

  const processLine = (line: string) => {
    idx++;
    if (idx <= opts.headerLineIndex) return; // skip metadata + header rows
    if (!line.trim()) return;
    const r = extractCsvRow(splitCsvLine(line), cfg);
    if (r) { let s = acc.get(r.hcpcs); if (!s) { s = new Set(); acc.set(r.hcpcs, s); } s.add(r.gross); }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
      if (++lc % 50000 === 0) onProgress(acc.size);
    }
  }
  if (buffer.length) processLine(buffer);
  return { rows: [...acc.entries()].map(([hcpcs, set]) => ({ hcpcs, gross: aggregate([...set], opts.method) })) };
}

// Stream just far enough to collect a few rows that actually extract under the
// detected columns. Needed because some MRFs list DRG/CDM rows (with a blank
// gross) for hundreds of thousands of lines before the CPT/HCPCS rows, so the
// first-256KB preview shows nothing even though the file is fine.
async function collectSample(file: File, headerLineIndex: number, cfg: any, want = 10, maxLines = 800000): Promise<string[][]> {
  const reader = (file.stream() as any).pipeThrough(new TextDecoderStream()).getReader();
  const out: string[][] = [];
  let buffer = "", idx = -1, lc = 0, stop = false;
  const proc = (line: string) => {
    idx++;
    if (idx <= headerLineIndex || !line.trim()) return;
    const cells = splitCsvLine(line);
    if (extractCsvRow(cells, cfg)) out.push(cells);
  };
  while (!stop) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      proc(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
      if (out.length >= want || ++lc >= maxLines) { stop = true; break; }
    }
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  return out;
}
import { CDMImport } from "@/components/cdm/CDMImport";
import { RUImport } from "@/components/cdm/RUImport";
import { FormularyImport } from "@/components/cdm/FormularyImport";
import { ScanButton } from "@/components/audit/ScanButton";
import { KPICard, SeverityBar, formatImpact } from "@/components/ui/shared";
import { RuleSettings } from "@/components/assessment/RuleSettings";
import { type FacilityType } from "@/lib/rule-catalog";
import { intakeFilesForFacility, type IntakeFile } from "@/lib/intake-files";

const AVCOLORS = ["#3b82f6", "#12b76a", "#7c3aed", "#f59e0b", "#ef4444"];

type Stats = {
  critical: number; high: number; medium: number; low: number;
  total: number; open: number; impact: number;
};
type Counts = { ru: number; formulary: number; claims: number };

// Three user steps; Peer Setup is an owner-only step. Analysis & Findings moved
// off the stepper onto the dashboard Findings tab.
const STEPS = [
  { key: "intake", label: "Intake", icon: ClipboardList },
  { key: "imports", label: "Imports", icon: Upload },
  { key: "review", label: "Review Imports", icon: FileSearch },
  { key: "peer", label: "Peer Setup", icon: Users },
];

export function AssessmentFlow({
  auditId, hospitalName, auditName, chargeItems, counts, stats, peerCounts, isOwner, disabledRules, status, intakeLocked, reviewPeriod, lowVolume, initialComps,
}: {
  auditId: string;
  hospitalName: string;
  auditName: string;
  chargeItems: number;
  counts: Counts;
  stats: Stats;
  peerCounts?: Record<string, number>;
  isOwner?: boolean;
  disabledRules?: string[];
  status?: string;
  intakeLocked?: boolean;
  reviewPeriod?: string;
  lowVolume?: number | null;
  initialComps?: { n: string; c: string }[] | null;
}) {
  // Once the intake steps (Intake -> Imports -> Review Imports) are finished, the
  // review is locked: profile, files, competitors, and rules become read-only.
  const locked = status === "completed" || !!intakeLocked;
  const [step, setStep] = useState(0);
  // Competitors are per-client, loaded from this audit's saved list (empty for a
  // brand-new client). Never seed shared/sample names across clients.
  const [comps, setComps] = useState<{ n: string; c: string }[]>(
    initialComps && initialComps.length ? initialComps : [{ n: "", c: "" }],
  );
  // Persist the competitor list to this audit whenever it meaningfully changes.
  const saveComps = (list: { n: string; c: string }[]) => {
    fetch("/api/audits/competitors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auditId, competitors: list }),
    }).catch(() => {});
  };
  const pc = peerCounts || {};

  // Non-owner (client) users see 3 steps; Peer Setup is owner-only.
  const visible = isOwner ? [0, 1, 2, 3] : [0, 1, 2];
  const nextOf = (cur: number) => visible[Math.min(visible.indexOf(cur) + 1, visible.length - 1)];
  const prevOf = (cur: number) => visible[Math.max(visible.indexOf(cur) - 1, 0)];

  // A step shows a green check when complete, red when not filled out yet.
  const stepComplete = (si: number) => {
    if (si === 0) return !!auditName && !!hospitalName;
    if (si === 1) return chargeItems > 0;
    if (si === 2) return chargeItems > 0;
    if (si === 3) return Object.values(pc).some((v) => (v as number) > 0);
    return false;
  };

  const router = useRouter();
  const [lockBusy, setLockBusy] = useState(false);
  const reopenIntake = async () => {
    setLockBusy(true);
    try {
      await fetch("/api/audits/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, locked: false }) });
      if (status === "completed") await fetch("/api/audits/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, status: "active" }) });
      router.refresh();
    } catch { /* ignore */ } finally { setLockBusy(false); }
  };

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 min-w-0 bg-[#f4f6f8] flex flex-col min-h-screen">
        {/* header */}
        <div className="bg-white border-b border-[#e6e9f2] px-8 py-4">
          <h1 className="text-[18px] font-bold tracking-tight text-[#0f172a]">{auditName}</h1>
          <p className="text-[12px] text-[#64748b] mt-0.5 flex items-center gap-1.5"><Building2 size={13} className="text-[#1e293b]" /> {hospitalName}</p>
        </div>

        {/* Horizontal stepper (green check = complete, red = not filled out) */}
        <div className="bg-white border-b border-[#e6e9f2] px-8 py-3">
          <div className="max-w-5xl mx-auto flex items-center gap-2">
            {visible.map((si, pos) => {
              const s = STEPS[si];
              const active = step === si;
              const complete = stepComplete(si);
              return (
                <Fragment key={s.key}>
                  <button onClick={() => setStep(si)} className="flex items-center gap-2 shrink-0">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${active ? "border-[#1e293b] bg-white" : complete ? "bg-[#12b76a] border-[#12b76a] text-white" : "bg-white border-[#ef4444]"}`}>
                      {complete ? <Check size={13} /> : active ? <span className="w-2 h-2 rounded-full bg-[#1e293b]" /> : <X size={12} className="text-[#ef4444]" />}
                    </span>
                    <span className={`text-[13px] ${active ? "font-bold text-[#1e293b]" : "font-medium text-[#475569]"}`}>{s.label}</span>
                  </button>
                  {pos < visible.length - 1 && <span className="flex-1 h-px bg-[#e2e6ec] min-w-[16px]" />}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6">
            {locked && (
              <div className="mb-4 rounded-xl border border-[#fde3c2] bg-[#fff8ef] px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] text-[#8a5a1a]"><Lock size={15} className="text-[#b45309]" /> Intake is complete, so this review is locked. The profile, files, competitors, and rules can&apos;t be changed. Peer Setup stays open.</div>
                <button onClick={reopenIntake} disabled={lockBusy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#1e293b] bg-white border border-[#c7d2fe] hover:bg-[#eef2ff] disabled:opacity-50">{lockBusy ? <Loader2 size={13} className="animate-spin" /> : null} Reopen to edit</button>
              </div>
            )}
            {step === 0 && <Intake comps={comps} setComps={setComps} saveComps={saveComps} hospitalName={hospitalName} auditName={auditName} peerCounts={pc} isOwner={isOwner} auditId={auditId} disabledRules={disabledRules || []} locked={locked} initialReviewPeriod={reviewPeriod} initialLowVolume={lowVolume} onNext={() => setStep(nextOf(0))} />}
            {step === 1 && <Imports auditId={auditId} chargeItems={chargeItems} counts={counts} locked={locked} onBack={() => setStep(prevOf(1))} onNext={() => setStep(nextOf(1))} />}
            {step === 2 && <Review auditId={auditId} counts={counts} chargeItems={chargeItems} isOwner={isOwner} onBack={() => setStep(prevOf(2))} onNext={() => setStep(nextOf(2))} />}
            {step === 3 && isOwner && <Peer comps={comps} setComps={setComps} saveComps={saveComps} auditId={auditId} peerCounts={pc} onBack={() => setStep(prevOf(3))} />}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------- shared bits ---------- */
function PageHead({ title, desc, right }: { title: string; desc: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div><h1 className="text-[22px] font-bold tracking-tight text-[#111827]">{title}</h1><p className="text-sm text-[#6b7280] mt-1">{desc}</p></div>
      {right}
    </div>
  );
}
const CARD = "bg-white rounded-2xl border border-[#edf0f4] p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)] mb-4";
function Footer({ onBack, backTxt, onNext, nextTxt }: { onBack?: () => void; backTxt?: string; onNext?: () => void; nextTxt?: string }) {
  return (
    <div className="flex justify-between mt-2">
      {onBack ? <button onClick={onBack} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">← {backTxt}</button> : <span />}
      {onNext && <button onClick={onNext} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a] shadow-sm">{nextTxt} →</button>}
    </div>
  );
}
const inputCls = "w-full h-10 border border-[#e2e6ec] rounded-lg px-3 text-[13px] focus:outline-none focus:border-[#1e293b] focus:ring-2 focus:ring-[#1e293b]/15";
const labelCls = "block text-xs font-semibold text-[#374151] mb-1.5";
function chip(text: string, tone: string) {
  const map: Record<string, string> = {
    green: "bg-[#e7f7ef] text-[#067647]", amber: "bg-[#fef4e2] text-[#b45309]",
    red: "bg-[#fdeceb] text-[#b42318]", gray: "bg-[#eef1f5] text-[#6b7280]", blue: "bg-[#eaf1fe] text-[#0f172a]",
  };
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${map[tone]}`}>{text}</span>;
}

/* ---------- STEP 1: INTAKE ---------- */
function Intake({ comps, setComps, saveComps, hospitalName, auditName, peerCounts, isOwner, onNext, auditId, disabledRules, locked, initialReviewPeriod, initialLowVolume }: any) {
  const facilityType: FacilityType = "short_term_acute";
  const [reviewPeriod, setReviewPeriod] = useState<string>(initialReviewPeriod || "");
  const [lowVolume, setLowVolume] = useState<string>(initialLowVolume != null ? String(initialLowVolume) : "10");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const savePeriod = async (v: string) => {
    setReviewPeriod(v); setSavingPeriod(true);
    try {
      await fetch("/api/audits/period", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, reviewPeriod: v }),
      });
    } finally { setSavingPeriod(false); }
  };
  const saveThreshold = async (v: string) => {
    await fetch("/api/audits/period", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auditId, lowVolumeThreshold: v === "" ? null : Number(v) }),
    });
  };
  const setComp = (idx: number, key: string, val: string) =>
    setComps(comps.map((c: any, j: number) => (j === idx ? { ...c, [key]: val } : c)));
  const isLocked = (name: string) => ((peerCounts || {})[name] || 0) > 0;
  return (
    <>
      <PageHead title="Intake" desc="Set up the review and the competitors to benchmark against." />
      <div className={CARD}>
        <h3 className="text-sm font-bold text-[#111827] mb-4">Review Profile</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Review name</label><input className={inputCls + (locked ? " bg-[#f6f7f9] text-[#6b7280]" : "")} defaultValue={auditName} disabled={locked} /></div>
          <div><label className={labelCls}>Entity name</label><input className={inputCls + (locked ? " bg-[#f6f7f9] text-[#6b7280]" : "")} defaultValue={hospitalName} disabled={locked} /></div>
          <div>
            <label className={labelCls}>Review date {savingPeriod && <span className="text-[#94a3b8]">· saving…</span>}</label>
            <input type="date" className={inputCls + (locked ? " bg-[#f6f7f9] text-[#6b7280]" : "")} value={reviewPeriod} disabled={locked} onChange={(e) => savePeriod(e.target.value)} />
            <p className="text-xs text-[#9aa2af] mt-1.5">Sets the review year. Codes not yet effective by this date are skipped.</p>
          </div>
          <div>
            <label className={labelCls}>Low-volume threshold (RVU analysis)</label>
            <input type="number" min={0} step={1} className={inputCls + (locked ? " bg-[#f6f7f9] text-[#6b7280]" : "")} value={lowVolume} disabled={locked}
              onChange={(e) => setLowVolume(e.target.value)} onBlur={(e) => saveThreshold(e.target.value)} placeholder="10" />
            <p className="text-xs text-[#9aa2af] mt-1.5">Annual units at or below this count flag a CPT/HCPCS line as low/no volume.</p>
          </div>
        </div>
      </div>
      <div className={CARD}>
        <h3 className="text-sm font-bold text-[#111827] mb-4">Competitors for peer analysis (up to 5)</h3>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2.5 text-[12px] text-[#92400e]">
          <Building2 size={14} className="mt-0.5 shrink-0 text-[#d97706]" />
          <span>Each competitor must have publicly available price-transparency data (a machine-readable file or shoppable-services list). Hospitals without published prices can't be benchmarked.</span>
        </div>
        {comps.map((c: any, i: number) => {
          const lk = isLocked(c.n) || locked;
          return (
            <div key={i} className="flex items-center gap-3 mb-3">
              <span className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0" style={{ background: AVCOLORS[i % AVCOLORS.length] }}>{(c.n || "?")[0]}</span>
              <input className={inputCls + (lk ? " bg-[#f6f7f9] text-[#6b7280]" : "")} value={c.n} disabled={lk} onChange={(e) => setComp(i, "n", e.target.value)} onBlur={() => saveComps?.(comps)} placeholder="Competitor hospital name" />
              <input className={inputCls + (lk ? " bg-[#f6f7f9] text-[#6b7280]" : "")} value={c.c} disabled={lk} onChange={(e) => setComp(i, "c", e.target.value)} onBlur={() => saveComps?.(comps)} placeholder="City, State" />
              {lk
                ? <span title={locked ? "Review locked" : "Price file loaded"} className="p-2 text-[#9aa2af]"><Lock size={15} /></span>
                : <button onClick={() => { const next = comps.filter((_: any, j: number) => j !== i); setComps(next); saveComps?.(next); }} className="p-2 rounded-lg hover:bg-[#f6f7f9] text-[#9aa2af]"><X size={16} /></button>}
            </div>
          );
        })}
        {comps.length < 5 && !locked && (
          <button onClick={() => setComps([...comps, { n: "", c: "" }])} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]"><Plus size={15} /> Add competitor</button>
        )}
        <p className="text-xs text-[#9aa2af] mt-3">These hospitals are benchmarked against {hospitalName} using their published price-transparency files.</p>
      </div>
      <RuleSettings auditId={auditId} initialDisabled={disabledRules} locked={locked} facilityType={facilityType} />
      <Footer onNext={onNext} nextTxt="Save & continue to Imports" />
    </>
  );
}

/* ---------- STEP 2: IMPORTS ---------- */
function Imports({ auditId, chargeItems, counts, locked, onBack, onNext }: any) {
  const files: IntakeFile[] = intakeFilesForFacility();
  const countOf = (f: IntakeFile) => f.countKey === "cdm" ? chargeItems : f.countKey ? (counts[f.countKey] || 0) : 0;
  const iconOf = (key: string) => key === "cdm" ? FileSpreadsheet : key === "ru" ? Database : key === "formulary" ? Pill : FileText;
  const control = (f: IntakeFile, uploaded: boolean) => {
    switch (f.handler) {
      case "cdm": return <CDMImport auditId={auditId} label={uploaded ? "Replace file" : "Upload CDM"} />;
      case "ru": return <RUImport auditId={auditId} label={uploaded ? "Replace file" : "Import R&U"} />;
      case "formulary": return <FormularyImport auditId={auditId} label={uploaded ? "Replace file" : "Import Formulary"} />;
      default: return <div className="text-[12px] text-[#9aa2af]">No automated import yet — provide this file to your reviewer.</div>;
    }
  };
  const SpecDetails = ({ f }: { f: IntakeFile }) => (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none inline-flex items-center gap-1 text-[12px] font-medium text-[#1e293b] hover:underline">
        <FileText size={12} /> View file spec
      </summary>
      <div className="mt-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
        <table className="w-full text-[11px]">
          <thead><tr className="text-left text-[#94a3b8]"><th className="pb-1 font-semibold">Column</th><th className="pb-1 font-semibold">Req</th><th className="pb-1 font-semibold">Notes</th></tr></thead>
          <tbody>
            {f.spec.map((c) => (
              <tr key={c.name} className="align-top border-t border-[#edf0f4]">
                <td className="py-1 pr-2 font-medium text-[#334155] whitespace-nowrap">{c.name}</td>
                <td className="py-1 pr-2 text-[#64748b]">{c.required ? "Yes" : "—"}</td>
                <td className="py-1 text-[#64748b]">{c.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a href={`/api/import-spec?type=${f.key}`} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#1e293b] hover:underline"><Download size={11} /> Download blank template (CSV)</a>
      </div>
    </details>
  );

  const Tile = ({ f }: { f: IntakeFile }) => {
    const Icon = iconOf(f.key);
    const handled = f.handler != null;
    const count = countOf(f);
    const uploaded = handled && count > 0;
    return (
      <div className="bg-white rounded-2xl border border-[#edf0f4] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)] flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl bg-[#f1f5f9] text-[#64748b] flex items-center justify-center"><Icon size={19} /></div>
          {uploaded
            ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#e7f7ef] text-[#067647]"><Check size={12} /> Uploaded</span>
            : <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${f.required ? "bg-[#fef4e2] text-[#b45309]" : "bg-[#eef1f5] text-[#6b7280]"}`}>{f.required ? "Required" : "Optional"}</span>}
        </div>
        <div><div className="font-bold text-sm text-[#111827]">{f.title}</div><div className="text-xs text-[#6b7280]">{f.desc}</div><div className="text-[11px] text-[#94a3b8] mt-1">Accepts: {f.accepts}</div><SpecDetails f={f} /></div>
        {handled && uploaded
          ? <div className="flex items-center justify-between text-[13px]">
              <span className="text-[#374151]"><span className="font-bold text-[#111827]">{count.toLocaleString()}</span> rows imported</span>
              <a href={`/api/export-import?type=${f.countKey}&auditId=${auditId}`} className="inline-flex items-center gap-1 text-[#1e293b] font-medium hover:underline"><Download size={13} /> Download</a>
            </div>
          : <div className="text-[13px] text-[#9aa2af]">No file yet</div>}
        {locked
          ? <div className="inline-flex items-center gap-1.5 text-[12px] text-[#9aa2af]"><Lock size={13} /> Locked</div>
          : control(f, uploaded)}
      </div>
    );
  };

  const handledFiles = files.filter((f) => f.handler != null);
  const done = handledFiles.filter((f) => countOf(f) > 0).length;
  return (
    <>
      <PageHead title="Imports" desc="Upload the client's files. Each tile shows its column spec and a blank template; already-uploaded files show their row counts." />
      <div className="rounded-xl px-4 py-3 mb-4 bg-[#f6f7f9] border border-[#edf0f4] text-[13px] text-[#374151] flex items-center gap-2">
        <Check size={15} className="text-[#12b76a]" /> {done} of {handledFiles.length} importable files uploaded.
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        {files.map((f) => <Tile key={f.key} f={f} />)}
      </div>
      <Footer onBack={onBack} backTxt="Back to Intake" onNext={onNext} nextTxt="Continue to Review" />
    </>
  );
}

/* ---------- STEP 3: REVIEW IMPORTS ---------- */
function Review({ auditId, counts, chargeItems, isOwner, onBack, onNext }: any) {
  const countOf = (f: IntakeFile) => f.countKey === "cdm" ? (chargeItems || 0) : f.countKey ? (counts[f.countKey] || 0) : 0;
  const files = intakeFilesForFacility().map((f) => ({
    key: f.key, name: f.title, type: f.handler ? f.handler.toUpperCase() : "Manual", total: countOf(f), optional: !f.required, handled: f.handler != null,
  }));
  const [sel, setSel] = useState<string>(files.find((f) => f.total > 0)?.key || "cdm");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const selFile = files.find((f) => f.key === sel)!;
  const router = useRouter();

  // Intake is finished once Review Imports is left for Peer Setup, so we lock the
  // review (profile, files, competitors, rules become read-only).
  const lockIntake = () => fetch("/api/audits/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, locked: true }) }).catch(() => {});

  const submitForReview = async () => {
    setSubmitting(true);
    try {
      // Run the CDM analysis so findings exist, then notify the reviewer that
      // peer files can be uploaded. Peer Setup re-runs it once peers are added.
      await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId }) });
      await fetch("/api/notify/peer-ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId }) });
      await lockIntake();
      setSubmitted(true);
      router.refresh();
    } catch { /* ignore */ } finally { setSubmitting(false); }
  };

  // Owner path: locking the intake, then continuing to Peer Setup.
  const goPeer = async () => { await lockIntake(); router.refresh(); onNext(); };

  const th = "text-left text-[11px] uppercase tracking-wide px-4 py-3 border-b border-[#edf0f4] font-semibold";
  return (
    <>
      <PageHead title="Review Imports" desc="Import status for every file. Select a file to see its detail." />
      {/* TOP TABLE — files + status */}
      <div className="bg-white rounded-2xl border border-[#edf0f4] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden mb-4">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-[#fbfcfd] text-[#9aa2af]">
            {["File", "Data type", "Status", "Total", "Successful", "Failed"].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>{files.map((f) => {
            const up = f.total > 0;
            return (
              <tr key={f.key} onClick={() => setSel(f.key)} className={`border-b border-[#edf0f4] last:border-0 cursor-pointer ${sel === f.key ? "bg-[#eff4ff]" : "hover:bg-[#f8fafc]"}`}>
                <td className="px-4 py-3 font-semibold text-[#111827]">{f.name}{f.optional && <span className="text-[#9aa2af] font-normal"> (optional)</span>}</td>
                <td className="px-4 py-3 text-[#374151]">{f.type}</td>
                <td className="px-4 py-3">{!f.handled ? chip("Provide to reviewer", "gray") : up ? chip("Completed", "green") : chip(f.optional ? "Not uploaded" : "Required", "amber")}</td>
                <td className="px-4 py-3 text-[#374151]">{up ? f.total.toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-[#067647]">{up ? f.total.toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-[#374151]">{up ? 0 : "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      {/* BOTTOM TABLE — detail for the selected file */}
      <div className={CARD}>
        <h3 className="text-sm font-bold text-[#111827] mb-3">{selFile.name} detail</h3>
        {selFile.total > 0 ? (
          <>
            <div className="rounded-xl px-4 py-3 mb-4 bg-[#e7f7ef] border border-[#c9ecd8] text-[13px] text-[#067647] flex items-center gap-2">
              <Check size={15} /> Import completed. {selFile.total.toLocaleString()} rows processed, {selFile.total.toLocaleString()} successful, 0 failed.
            </div>
            <div className="space-y-2">
              {["File received and read", "Columns detected and mapped", `${selFile.total.toLocaleString()} rows loaded`].map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px] text-[#374151]"><Check size={14} className="text-[#12b76a]" /> {s}</div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl px-4 py-3 bg-[#fef4e2] border border-[#f6dfa8] text-[13px] text-[#8a5a1a] flex items-center gap-2">
            <AlertTriangle size={15} className="text-[#b45309]" /> {selFile.optional ? "Not uploaded (optional). Upload it on the Imports step if you have it." : "Not uploaded yet. Go to the Imports step to add this file."}
          </div>
        )}
      </div>

      {isOwner ? (
        <Footer onBack={onBack} backTxt="Back to Imports" onNext={goPeer} nextTxt="Lock intake & continue to Peer Setup" />
      ) : submitted ? (
        <div className="rounded-xl px-4 py-3 bg-[#e7f7ef] border border-[#c9ecd8] text-[13px] text-[#067647] flex items-center gap-2"><Check size={15} /> Submitted. Your reviewer has been notified and will complete the peer analysis.</div>
      ) : (
        <div className="flex justify-between mt-2">
          <button onClick={onBack} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">← Back to Imports</button>
          <button onClick={submitForReview} disabled={submitting} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a] shadow-sm disabled:opacity-50">{submitting ? "Submitting…" : "Submit for review →"}</button>
        </div>
      )}
    </>
  );
}

/* ---------- STEP 4: PEER SETUP ---------- */
function PeerRow({ i, name, auditId, initialCount = 0, onChanged }: { i: number; name: string; auditId: string; initialCount?: number; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(initialCount > 0);
  const [status, setStatus] = useState<string | null>(initialCount > 0 ? `${initialCount.toLocaleString()} codes loaded` : null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [sel, setSel] = useState({ codeIdx: -1, typeIdx: -1, grossIdx: -1, method: "median" });
  const ref = useRef<HTMLInputElement>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setStatus("Reading file…");
    try {
      if (f.name.toLowerCase().endsWith(".json")) {
        const r = parseMrf(await f.text());
        if (!r.rows.length) { setStatus("No prices found" + (r.note ? ` (${r.note})` : "")); setBusy(false); return; }
        await postRows(r.rows);
      } else {
        // Read the start of the file to detect + preview columns before the full parse.
        const headText = await f.slice(0, 262144).text();
        const pv = previewCsv(headText);
        if (pv.hi < 0 || !pv.headers.length) { setStatus("Couldn't detect a header row. Is this a CMS price-transparency file?"); setBusy(false); return; }
        // The first rows of some MRFs are DRG/CDM with a blank gross; scan deeper
        // to surface real CPT/HCPCS sample rows so the preview isn't empty.
        let sample = pv.sample;
        if (pv.def.codeIdx >= 0 && pv.def.grossIdx >= 0) {
          setStatus("Scanning file for codes…");
          try {
            const cfg0 = { grossIdx: pv.def.grossIdx, codeCols: [{ ci: pv.def.codeIdx, ti: pv.def.typeIdx, direct: pv.def.typeIdx < 0 }] };
            const scanned = await collectSample(f, pv.hi, cfg0);
            if (scanned.length) sample = scanned;
          } catch { /* keep head sample */ }
        }
        setFile(f); setPreview({ ...pv, sample });
        setSel({ codeIdx: pv.def.codeIdx, typeIdx: pv.def.typeIdx, grossIdx: pv.def.grossIdx, method: "median" });
        setBusy(false); setStatus(null);
      }
    } catch (err: any) { setStatus("Failed: " + err.message); setBusy(false); }
    finally { if (ref.current) ref.current.value = ""; }
  };

  const postRows = async (rows: { hcpcs: string; gross: number }[]) => {
    setStatus(`Uploading ${rows.length.toLocaleString()} codes…`);
    const res = await fetch("/api/import-peer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, competitor: name, rows }) });
    const j = await res.json();
    if (!res.ok) { setStatus("Failed: " + (j.error || res.status)); setBusy(false); return; }
    setLoaded(true); setStatus(`${(j.inserted || 0).toLocaleString()} codes loaded`);
    onChanged?.();
  };

  const confirmImport = async () => {
    if (!file || sel.codeIdx < 0 || sel.grossIdx < 0) return;
    setBusy(true); setStatus("Parsing…");
    try {
      const { rows } = await streamCsvFile(file, { headerLineIndex: preview.hi, codeIdx: sel.codeIdx, typeIdx: sel.typeIdx, grossIdx: sel.grossIdx, method: sel.method }, (codes) => setStatus(`Parsing… ${codes.toLocaleString()} codes`));
      if (!rows.length) { setStatus("No prices extracted with these columns — adjust the mapping."); setBusy(false); return; }
      await postRows(rows);
      setPreview(null); setFile(null);
    } catch (err: any) { setStatus("Failed: " + err.message); setBusy(false); }
  };

  // live preview of what the current mapping extracts
  const cfg = { grossIdx: sel.grossIdx, codeCols: [{ ci: sel.codeIdx, ti: sel.typeIdx, direct: sel.typeIdx < 0 }] };
  const previewRows: any[] = preview ? preview.sample.map((r: string[]) => extractCsvRow(r, cfg)).filter(Boolean).slice(0, 5) : [];
  const colOpts = (v: number, onChange: (n: number) => void, allowNone = false) => (
    <select value={v} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-9 border border-[#e2e6ec] rounded-lg px-2 text-[13px] focus:outline-none focus:border-[#1e293b]">
      {allowNone && <option value={-1}>— none —</option>}
      {preview?.headers.map((h: string, idx: number) => <option key={idx} value={idx}>{h || `(column ${idx + 1})`}</option>)}
    </select>
  );

  return (
    <div className="flex items-center justify-between gap-3 border border-[#edf0f4] rounded-xl px-4 py-3 mb-2.5">
      <div className="flex items-center gap-2.5 min-w-[220px]">
        <span className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ background: AVCOLORS[i % AVCOLORS.length] }}>{(name || "?")[0]}</span>
        <div><div className="font-semibold text-[13px] text-[#111827]">{name}</div><div className="text-xs text-[#9aa2af]">CMS price-transparency file (.json / .csv)</div></div>
      </div>
      <input ref={ref} type="file" accept=".json,.csv,.txt" className="hidden" onChange={onFile} />
      <div className="flex items-center gap-3">
        {status && <span className={`text-[12px] ${loaded ? "text-[#067647]" : "text-[#6b7280]"} max-w-[200px] truncate`}>{status}</span>}
        {loaded ? (
          <>
            <a href={`/api/export-import?type=peer&auditId=${auditId}&competitor=${encodeURIComponent(name)}`} className="inline-flex items-center gap-1 text-xs text-[#1e293b] font-medium hover:underline"><Download size={13} /> Download</a>
            <button onClick={() => ref.current?.click()} className="text-xs text-[#6b7280] hover:underline">Replace</button>
          </>
        ) : (
          <button onClick={() => ref.current?.click()} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9] disabled:opacity-50">{busy && !preview ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload file</button>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setPreview(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#edf0f4] sticky top-0 bg-white rounded-t-2xl flex items-center justify-between">
              <div><h3 className="text-sm font-bold text-[#111827]">Match columns — {name}</h3><p className="text-xs text-[#9aa2af] mt-0.5">Detected hospital: {preview.competitor || "—"}</p></div>
              <button onClick={() => setPreview(null)} className="p-2 rounded-lg hover:bg-[#f6f7f9] text-[#9aa2af]"><X size={18} /></button>
            </div>
            <div className="p-6">
              <p className="text-xs text-[#6b7280] mb-4">Confirm which columns hold the procedure code and the gross charge. We auto-detected them — adjust if the preview below looks wrong.</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-[#374151] mb-1.5">Procedure code column</label>{colOpts(sel.codeIdx, (n) => setSel({ ...sel, codeIdx: n }))}</div>
                <div><label className="block text-xs font-semibold text-[#374151] mb-1.5">Code type column (optional)</label>{colOpts(sel.typeIdx, (n) => setSel({ ...sel, typeIdx: n }), true)}</div>
                <div><label className="block text-xs font-semibold text-[#374151] mb-1.5">Gross charge column</label>{colOpts(sel.grossIdx, (n) => setSel({ ...sel, grossIdx: n }))}</div>
                <div><label className="block text-xs font-semibold text-[#374151] mb-1.5">When a code has multiple prices, use</label>
                  <select value={sel.method} onChange={(e) => setSel({ ...sel, method: e.target.value })} className="w-full h-9 border border-[#e2e6ec] rounded-lg px-2 text-[13px] focus:outline-none focus:border-[#1e293b]">
                    <option value="median">Median price</option><option value="average">Average price</option><option value="max">Highest price</option>
                  </select>
                </div>
              </div>
              <div className="mt-5">
                <div className="text-xs font-semibold text-[#374151] mb-2">Preview</div>
                {previewRows.length ? (
                  <div className="border border-[#edf0f4] rounded-xl overflow-hidden">
                    <table className="w-full text-[13px]"><thead><tr className="bg-[#fbfcfd] text-[#9aa2af]"><th className="text-left text-[11px] uppercase px-3 py-2">Code</th><th className="text-left text-[11px] uppercase px-3 py-2">Gross charge</th></tr></thead>
                      <tbody>{previewRows.map((r: any, k: number) => <tr key={k} className="border-t border-[#edf0f4]"><td className="px-3 py-2 font-semibold">{r.hcpcs}</td><td className="px-3 py-2">${r.gross.toLocaleString()}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : (sel.codeIdx >= 0 && sel.grossIdx >= 0)
                  ? <div className="text-[13px] text-[#6b7280] bg-[#f6f7f9] rounded-lg px-3 py-2">No sample codes near the top of this file (its first rows may be DRG/CDM lines with no gross). The full file is still processed on import — click Import prices to run it.</div>
                  : <div className="text-[13px] text-[#b45309] bg-[#fef4e2] rounded-lg px-3 py-2">Pick the column that holds the CPT/HCPCS code and a numeric gross charge.</div>}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[#edf0f4] sticky bottom-0 bg-white rounded-b-2xl flex items-center justify-between">
              <button onClick={() => setPreview(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">Cancel</button>
              <button onClick={confirmImport} disabled={busy || sel.codeIdx < 0 || sel.grossIdx < 0} className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a] disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />} Import prices</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Surfaces competitor price data that exists in the database but is NOT in the
// current competitor list (usually left behind when a competitor was renamed
// after upload). This data still counts in the comparison, so it is shown here
// with a Remove control to keep the peer benchmark accurate.
function OrphanPeers({ comps, peerCounts, auditId, onChanged }: any) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const known = new Set(comps.map((c: any) => String(c.n || "").trim()).filter(Boolean));
  const orphans = Object.entries(peerCounts || {})
    .filter(([k, v]: any) => Number(v) > 0 && !known.has(String(k).trim()) && !removed.includes(k));
  if (!orphans.length) return null;

  const remove = async (name: string) => {
    setBusy(name);
    try {
      await fetch("/api/import-peer", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, competitor: name }) });
      setRemoved((r) => [...r, name]);
      onChanged?.();
    } catch {}
    setBusy(null);
  };

  return (
    <div className="mt-4 rounded-xl border border-[#fde3c2] bg-[#fff8ef] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-[#b45309] mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-[#b45309]">Other loaded data not in your competitor list</div>
          <p className="text-xs text-[#8a6d3b] mt-0.5">This price data is still counted in the comparison. It usually comes from a competitor that was renamed after its file was uploaded. Remove anything you did not intend to include.</p>
          <div className="mt-3 space-y-2">
            {orphans.map(([k, v]: any) => (
              <div key={k} className="flex items-center justify-between gap-3 bg-white border border-[#f0d9b8] rounded-lg px-3 py-2">
                <div className="text-[13px] text-[#111827]"><b>{k}</b> <span className="text-[#9aa2af]">· {Number(v).toLocaleString()} codes</span></div>
                <button onClick={() => remove(k)} disabled={busy === k} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#b42318] hover:underline disabled:opacity-50">{busy === k ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Peer({ comps, setComps, saveComps, auditId, peerCounts, onBack }: any) {
  // The analysis runs automatically after peer files are added or changed
  // (debounced). No manual "run" button.
  const [scanState, setScanState] = useState<"idle" | "running" | "done">("idle");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState("");
  const [newComp, setNewComp] = useState("");
  const timer = useRef<any>(null);
  // Competitors can be added here without reopening the (locked) Intake — peer
  // files attach to whatever competitor name is uploaded.
  const addComp = () => {
    const name = newComp.trim();
    if (!name || (comps || []).some((c: any) => (c.n || "").trim().toLowerCase() === name.toLowerCase())) return;
    const next = [...(comps || []), { n: name, c: "" }];
    setComps?.(next); saveComps?.(next);
    setNewComp("");
  };
  const autoScan = () => {
    setScanState("running"); setScanErr("");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId }) });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setScanState("idle"); setScanErr(j.error || `Scan failed (${res.status})`);
          return;
        }
        setScanState("done"); setLastRun(new Date().toLocaleTimeString());
        // Peer files now exist → review is "Ready"; email entity users once.
        fetch("/api/notify/ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId }) }).catch(() => {});
      } catch (e: any) { setScanState("idle"); setScanErr(e?.message || "Scan failed to start"); }
    }, 1500);
  };
  return (
    <>
      <div className="mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold tracking-tight text-[#111827]">Peer Setup</h1>
        </div>
        <p className="text-sm text-[#6b7280] mt-1.5">Load each competitor's price-transparency file.</p>
      </div>
      <div className={CARD}>
        <h3 className="text-sm font-bold text-[#111827] mb-4">Competitor price-transparency files (from Intake)</h3>
        {comps.map((c: any, i: number) => <PeerRow key={i} i={i} name={c.n} auditId={auditId} initialCount={(peerCounts || {})[c.n] || 0} onChanged={autoScan} />)}
        <OrphanPeers comps={comps} peerCounts={peerCounts} auditId={auditId} onChanged={autoScan} />
        {/* Add a competitor here without reopening the locked Intake. */}
        <div className="mt-3 flex items-center gap-2">
          <input value={newComp} onChange={(e) => setNewComp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} placeholder="Add a competitor hospital name" className="flex-1 h-10 border border-[#e2e6ec] rounded-lg px-3 text-[13px] focus:outline-none focus:border-[#1e293b] focus:ring-2 focus:ring-[#1e293b]/15" />
          <button onClick={addComp} disabled={!newComp.trim()} className="flex items-center gap-1.5 px-4 h-10 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9] disabled:opacity-50"><Plus size={15} /> Add competitor</button>
        </div>
        <p className="text-xs text-[#9aa2af] mt-3">You can add competitors here even after intake is locked.</p>
      </div>
      <div className={CARD}>
        <div className="flex items-center gap-2 text-[13px]">
          {scanState === "running" ? <><Loader2 size={15} className="animate-spin text-[#1e293b]" /> <span className="text-[#374151]">Running analysis…</span></>
            : scanState === "done" ? <><Check size={15} className="text-[#12b76a]" /> <span className="text-[#374151]">Analysis updated automatically{lastRun ? ` at ${lastRun}` : ""}.</span></>
            : <span className="text-[#6b7280]">The analysis runs automatically when you add or change a peer file.</span>}
        </div>
        {scanErr && <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">Scan error: {scanErr}</div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={autoScan} disabled={scanState === "running"} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-[#e2e6ec] text-[#374151] text-sm font-semibold hover:bg-[#f6f7f9] disabled:opacity-50">
            {scanState === "running" ? <><Loader2 size={15} className="animate-spin" /> Running…</> : <><Zap size={15} /> Run analysis now</>}
          </button>
          <a href={`/reports?auditId=${auditId}`} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1e293b] text-white text-sm font-semibold hover:bg-[#0f172a]">View peer analysis <ArrowRight size={15} /></a>
          <a href={`/findings?auditId=${auditId}`} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-[#e2e6ec] text-[#374151] text-sm font-semibold hover:bg-[#f6f7f9]">View findings</a>
        </div>
        <p className="text-xs text-[#9aa2af] mt-2">Backup: the analysis runs automatically when peer files change, but you can re-run it here anytime.</p>
      </div>
      <div className="flex justify-between mt-2">
        <button onClick={onBack} className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">← Back to Review</button>
      </div>
    </>
  );
}

/* ---------- STEP 5: ANALYSIS & FINDINGS ---------- */
function Analysis({ auditId, chargeItems, stats, onBack }: any) {
  const [tab, setTab] = useState("findings");
  return (
    <>
      <PageHead title="Analysis & Findings" desc="Complete results, peer analysis, and project management."
        right={<Link href={`/reports?auditId=${auditId}`} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a] shadow-sm flex items-center gap-2"><Download size={15} /> Export report</Link>} />
      <div className="grid grid-cols-4 gap-4 mb-4">
        <KPICard highlight icon={DollarSign} label="Est. impact" value={formatImpact(stats.impact)} subtext="identified opportunity" />
        <KPICard color="blue" icon={FileSpreadsheet} label="Charge lines" value={chargeItems.toLocaleString()} />
        <KPICard color="purple" icon={ListChecks} label="Total findings" value={stats.total.toLocaleString()} />
        <KPICard color="amber" icon={AlertTriangle} label="Open issues" value={stats.open.toLocaleString()} />
      </div>
      <div className={CARD}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-[#111827]">Findings by severity</h3></div>
        <SeverityBar counts={{ critical: stats.critical, high: stats.high, medium: stats.medium, low: stats.low }} />
      </div>
      <div className="flex gap-2 mb-4">
        {[["findings", "CDM Findings"], ["peer", "Peer Pricing Analysis"], ["pm", "Project Management"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-semibold border ${tab === k ? "bg-[#1e3a8a] text-white border-[#1e3a8a]" : "bg-white text-[#6b7280] border-[#edf0f4] hover:bg-[#f6f7f9]"}`}>{l}</button>
        ))}
      </div>
      {tab === "findings" && (
        <div className={CARD + " text-center"}>
          <p className="text-sm text-[#6b7280] mb-4">The full findings list, filterable by severity, category, and status, with inline assignee and status.</p>
          <Link href={`/findings?auditId=${auditId}`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a]">Open findings ({stats.total.toLocaleString()}) →</Link>
        </div>
      )}
      {tab === "peer" && <PeerAnalysisTab auditId={auditId} />}
      {tab === "pm" && (
        <div className="bg-white rounded-2xl border border-[#edf0f4] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden mb-4">
          <table className="w-full text-[13px]">
            <thead><tr className="bg-[#fbfcfd] text-[#9aa2af]">{["Task", "Owner", "Due", "Status"].map(h => <th key={h} className="text-left text-[11px] uppercase tracking-wide px-4 py-3 border-b border-[#edf0f4]">{h}</th>)}</tr></thead>
            <tbody>{[["Fix retired HCPCS codes", "Kaylee", "Sep 5", ["In progress", "amber"]], ["Reprice below-market outpatient services", "Kaylee", "Sep 12", ["Open", "gray"]], ["Resolve 837 import errors with client", "Kaylee", "Aug 30", ["Resolved", "green"]]].map((r: any, i) => (
              <tr key={i} className="border-b border-[#edf0f4] last:border-0"><td className="px-4 py-3 text-[#374151]">{r[0]}</td><td className="px-4 py-3">{r[1]}</td><td className="px-4 py-3">{r[2]}</td><td className="px-4 py-3">{chip(r[3][0], r[3][1])}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className={CARD}>
        <h3 className="text-sm font-bold text-[#111827] mb-3">Run / re-run analysis</h3>
        <ScanButton auditId={auditId} />
      </div>
      <Footer onBack={onBack} backTxt="Back to Peer Setup" />
    </>
  );
}

// Box-plot cell: a min→max bar with a median tick and the client's charge marker,
// so you can see at a glance where the client sits in the competitor range.
function PriceRange({ min, max, median, your }: { min: number; max: number; median: number; your: number }) {
  const lo = Math.min(min, your), hi = Math.max(max, your);
  const span = hi - lo || 1;
  const at = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="relative h-5 w-40">
      <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 rounded bg-[#e2e6ec]" />
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-[#cbd5e1]" style={{ left: at(min), right: `calc(100% - ${at(max)})` }} />
      <div className="absolute top-1/2 w-px h-3 -translate-y-1/2 bg-[#64748b]" style={{ left: at(median) }} title={`Median $${median.toLocaleString()}`} />
      <div className="absolute top-1/2 w-2.5 h-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white" style={{ left: at(your), background: your < median ? "#1e293b" : "#ef4444" }} title={`Your charge $${your.toLocaleString()}`} />
    </div>
  );
}

export function PeerAnalysisTab({ auditId }: { auditId: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [belowOnly, setBelowOnly] = useState(false);
  const [trustedOnly, setTrustedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true; setLoading(true); setErr(null);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ auditId });
      if (belowOnly) params.set("below", "1");
      if (trustedOnly) params.set("trusted", "1");
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/peer-compare?${params.toString()}`).then((r) => r.json()).then((j) => { if (!alive) return; j.error ? setErr(j.error) : setData(j); setLoading(false); }).catch((e) => { if (alive) { setErr(e.message); setLoading(false); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [auditId, belowOnly, trustedOnly, q]);

  if (err) return <div className={CARD + " text-[13px] text-[#b42318]"}>Couldn&apos;t load peer comparison: {err}</div>;
  if (!data) return <div className={CARD + " text-[13px] text-[#6b7280] flex items-center gap-2"}><Loader2 size={14} className="animate-spin" /> Loading peer comparison…</div>;
  const noFilters = !belowOnly && !trustedOnly && !q.trim();
  if (!data.summary.total) return <div className={CARD + " text-[13px] text-[#6b7280]"}>No overlapping codes yet. Upload competitor price files in Peer Setup, then run the analysis.</div>;

  const s = data.summary;
  const comps: string[] = data.competitors || [];
  // Filtering + search now happen on the server across the full result set, so
  // the table reflects every matching code (not just the first 50). We keep the
  // trustworthy-first ordering for display.
  const shown = [...data.rows].sort((a: any, b: any) => (Number(b.trustworthy) - Number(a.trustworthy)));
  const matched = data.matched ?? data.rows.length;
  const contextChip = (r: any) => {
    if (r.drug) return chip("Drug — review vs ASP", "gray");
    if (r.ambiguous) return chip("Confirm coding", "amber");
    if (r.sampleTier === "single") return chip("Single source", "gray");
    if (r.dispersed) return chip(`Peers disagree ${r.spread}x`, "amber");
    if (r.peerOutlier) return chip("Peer off vs Medicare", "amber");
    if (r.nearCms) return chip("≈ Medicare (cost/send-out?)", "amber");
    if (r.extremeGap) return chip("Extreme gap — confirm", "red");
    if (r.sampleTier === "thin") return chip("Thin sample (2 peers)", "gray");
    return chip("Comparable", "green");
  };
  const stat = (label: string, val: number, color: string) => (
    <div className="bg-white rounded-2xl border border-[#edf0f4] p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="text-xl font-bold" style={{ color }}>{val.toLocaleString()}</div><div className="text-[12px] text-[#6b7280] mt-0.5">{label}</div>
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-4 gap-3 mb-2">
        {stat("Below market", s.below, "#1e293b")}
        {stat("Above market", s.above, "#ef4444")}
        {stat("At market", s.at, "#12b76a")}
        {stat("Codes compared", s.total, "#111827")}
      </div>
      {(s.yourMarkupMedian != null || s.peerMarkupMedian != null) && (
        <div className="mb-2 flex items-center gap-4 text-[12px] text-[#374151] bg-[#f8fafc] border border-[#edf0f4] rounded-xl px-4 py-2.5">
          <span><span className="font-semibold">Markup over Medicare (median):</span> your CDM {s.yourMarkupMedian != null ? `${s.yourMarkupMedian}x` : "n/a"} · peers {s.peerMarkupMedian != null ? `${s.peerMarkupMedian}x` : "n/a"}</span>
          <span className="text-[#94a3b8]">Reference: commercial charges typically run ~2.5x Medicare; a common CDM target band is 2.5–3.0x.</span>
        </div>
      )}
      {s.maxPeers != null && s.maxPeers < 3 && (
        <div className="mb-2 text-[12px] text-[#b45309] bg-[#fef4e2] border border-[#fde3b8] rounded-xl px-4 py-2.5">
          Only {s.maxPeers} competitor{s.maxPeers === 1 ? "" : "s"} loaded. A reliable market read needs 3+ (5+ is ideal). With fewer than 3, the median is just a midpoint between individual hospitals, so no row can be marked high-confidence. Add more competitor price files in Peer Setup to strengthen the analysis.
        </div>
      )}
      {s.drugExcluded > 0 && (
        <div className="mb-2 text-[12px] text-[#6b7280]">
          {s.drugExcluded.toLocaleString()} drug/biological codes are excluded from the market signal — drugs are billed per dosage unit that differs by package size across hospitals, so gross-charge peer comparison isn&apos;t apples-to-apples. Drug pricing is reviewed against the ASP limit in Rule Findings instead.
        </div>
      )}
      {s.placeholderDropped > 0 && (
        <div className="mb-4 text-[12px] text-[#6b7280]">
          {s.placeholderDropped.toLocaleString()} codes were dropped because the only competitor prices were placeholder/filler values — a charge one competitor repeats across 15+ unrelated codes (e.g. the same $448 on dozens of codes) is a default fill in their price file, not a real per-code charge.
        </div>
      )}
      <div className="bg-white rounded-2xl border border-[#edf0f4] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#edf0f4] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter code or description…" className="h-8 w-56 border border-[#e2e6ec] rounded-lg px-3 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
            <label className="flex items-center gap-1.5 text-[12px] text-[#374151]"><input type="checkbox" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} /> Below market only</label>
            <label className="flex items-center gap-1.5 text-[12px] text-[#374151]"><input type="checkbox" checked={trustedOnly} onChange={(e) => setTrustedOnly(e.target.checked)} /> High-confidence only</label>
          </div>
          <a href={`/api/peer-compare?auditId=${auditId}&format=xlsx`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#1e293b] hover:underline whitespace-nowrap"><Download size={13} /> Download full (Excel)</a>
          {loading && <Loader2 size={13} className="animate-spin text-[#94a3b8]" />}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-[#fbfcfd] text-[#9aa2af]">
            {["HCPCS", "Description", "Your charge", ...comps, "Median", "Range (min–max)", "% of median", "Your ×MCR", "Peer ×MCR", "Position", "Context"].map((h) => <th key={h} className="text-left text-[11px] uppercase tracking-wide px-3 py-3 border-b border-[#edf0f4] whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>{shown.length === 0 ? (
            <tr><td colSpan={comps.length + 10} className="px-3 py-8 text-center text-[13px] text-[#94a3b8]">{loading ? "Loading…" : "No codes match this filter."}</td></tr>
          ) : shown.map((r: any, i: number) => (
            <tr key={i} className="border-b border-[#edf0f4] last:border-0">
              <td className="px-3 py-3 font-semibold">{r.code}</td>
              <td className="px-3 py-3 text-[#374151] max-w-[200px] truncate" title={r.desc}>{r.desc}</td>
              <td className={`px-3 py-3 font-semibold ${r.belowMarket ? "text-[#1e293b]" : "text-[#111827]"}`}>${r.your.toLocaleString()}</td>
              {comps.map((c) => <td key={c} className="px-3 py-3 text-[#6b7280] whitespace-nowrap">{r.comps?.[c] != null ? `$${r.comps[c].toLocaleString()}` : "—"}</td>)}
              <td className="px-3 py-3 text-[#374151]">${(r.median ?? r.peer).toLocaleString()}</td>
              <td className="px-3 py-3"><PriceRange min={r.min} max={r.max} median={r.median ?? r.peer} your={r.your} /></td>
              <td className="px-3 py-3">{r.pct}%</td>
              <td className="px-3 py-3 whitespace-nowrap text-[#374151]">{r.yourMk != null ? `${r.yourMk}x` : "—"}</td>
              <td className="px-3 py-3 whitespace-nowrap text-[#6b7280]">{r.peerMk != null ? `${r.peerMk}x` : "—"}</td>
              <td className="px-3 py-3">{r.drug ? chip("Not comparable", "gray") : r.ambiguous ? chip("Confirm coding", "amber") : r.belowMarket ? chip("Below market", "blue") : r.position === "above" ? chip("Above market", "red") : chip("At market", "green")}</td>
              <td className="px-3 py-3 whitespace-nowrap">{contextChip(r)}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
        <div className="px-4 py-2 text-[11px] text-[#94a3b8] border-t border-[#edf0f4]">Blue marker = your charge below the competitor median; red = above. Showing {shown.length} of {matched.toLocaleString()} matching codes{matched > shown.length ? " (first 200)" : ""}{noFilters ? "" : " — filtered"}.</div>
      </div>
    </>
  );
}
