"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Upload, Loader2, Check, X } from "lucide-react";

const TARGETS = [
  { key: "procedure_number", label: "Procedure Number", req: false },
  { key: "charge_description", label: "Charge Description", req: true },
  { key: "hcpcs_cpt_code", label: "HCPCS/CPT Code", req: true },
  { key: "revenue_code", label: "Revenue Code", req: true },
  { key: "department", label: "Department", req: false },
  { key: "department_gl", label: "Department G/L", req: false },
  { key: "gross_charge", label: "Gross Charge", req: true },
  { key: "unit_of_service", label: "Unit of Service", req: false },
  { key: "units_billed", label: "Units Billed", req: false },
  { key: "ndc_code", label: "NDC Code", req: false },
  { key: "modifier_1", label: "Modifier 1", req: false },
  { key: "modifier_2", label: "Modifier 2", req: false },
  { key: "service_line", label: "Service Line", req: false },
];
const ALIASES: Record<string, string[]> = {
  procedure_number: ["procedurenumber", "procedureno", "procnum", "cdmnumber", "cdm", "cdmcode", "chargecode", "itemnumber", "chargenumber"],
  charge_description: ["chargedescription", "description", "desc", "chargedesc", "servicedescription", "cdmdescription", "itemdescription"],
  hcpcs_cpt_code: ["hcpcscpt", "hcpcscptcode", "hcpcs", "cptcode", "cpt", "hcpc"],
  revenue_code: ["revenuecode", "revcode", "revenue", "ubrev", "rev"],
  department: ["departmentname", "department", "deptname", "dept"],
  department_gl: ["departmentgl", "deptgl", "glcode", "generalledger", "gl"],
  gross_charge: ["grosscharge", "grosscharges", "gross", "chargeamount", "price", "amount", "fee", "charge"],
  unit_of_service: ["unitofservice", "unitsofservice", "uos", "unitservice"],
  units_billed: ["unitsbilled", "billedunits", "units", "quantity", "qty"],
  ndc_code: ["ndccode", "ndcnumber", "ndc"],
  modifier_1: ["modifier1", "mod1", "modifier"],
  modifier_2: ["modifier2", "mod2"],
  service_line: ["serviceline", "svcline", "servicearea"],
};
const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function autoMap(headers: string[]) {
  const normed = headers.map((h) => ({ raw: h, n: norm(h) }));
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  const pass = (mode: "exact" | "contains") => {
    for (const { key } of TARGETS) {
      if (mapping[key]) continue;
      for (const a of ALIASES[key]) {
        const hit = normed.find((h) => !used.has(h.raw) && (mode === "exact" ? h.n === a : h.n.includes(a)));
        if (hit) { mapping[key] = hit.raw; used.add(hit.raw); break; }
      }
    }
  };
  pass("exact"); pass("contains");
  return mapping;
}

export function CDMImport({ auditId, label = "Upload CDM" }: { auditId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [syncPrompt, setSyncPrompt] = useState<{ missing: number } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg("Reading file…");
    const load = (data: Record<string, any>[]) => {
      const clean = data.filter((x) => x && Object.keys(x).length);
      if (!clean.length) { setMsg("No rows found in the file."); setBusy(false); return; }
      const hdrs = Object.keys(clean[0]);
      setRows(clean); setHeaders(hdrs); setMapping(autoMap(hdrs)); setFileName(file.name);
      setBusy(false); setMsg(null);
    };
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".csv")) {
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => load(r.data as any[]), error: (err) => { setMsg("Parse error: " + err.message); setBusy(false); } });
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        load(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, any>[]);
      } else { setMsg("Upload a .csv, .xlsx, or .xls file."); setBusy(false); }
    } catch (err: any) { setMsg("Failed: " + err.message); setBusy(false); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const runImport = async () => {
    const missing = TARGETS.filter((t) => t.req && !mapping[t.key]).map((t) => t.label);
    if (missing.length) { setMsg("Map required column(s): " + missing.join(", ")); return; }
    setBusy(true);
    const CHUNK = 2000;
    let inserted = 0;
    for (let i = 0; i < rows!.length; i += CHUNK) {
      const chunk = rows!.slice(i, i + CHUNK);
      const res = await fetch("/api/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, items: chunk, columnMappings: mapping, replace: i === 0 }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg("Failed: " + (j.error || res.status)); setBusy(false); return; }
      inserted += j.inserted || 0; setMsg(`Importing… ${inserted.toLocaleString()} rows`);
    }
    setRows(null); setMsg(`Imported ${inserted.toLocaleString()} charge lines.`);

    // Smart-sync: reconcile this fresh upload against changes we recommended in
    // prior reviews. Auto-mark the ones the hospital implemented; if any approved
    // changes are still missing from this EHR extract, offer to re-apply them.
    try {
      const r = await fetch("/api/change-log/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, action: "reconcile" }) });
      const j = await r.json();
      if (r.ok && (j.missing || 0) > 0) { setSyncPrompt({ missing: j.missing }); setBusy(false); return; }
    } catch { /* non-fatal */ }

    setBusy(false);
    router.refresh();
  };

  const reapplyMissing = async () => {
    setSyncBusy(true);
    try { await fetch("/api/change-log/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, action: "reapply" }) }); } catch { /* ignore */ }
    setSyncBusy(false); setSyncPrompt(null); router.refresh();
  };

  return (
    <div className="flex flex-col items-stretch">
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
        title="Upload the chargemaster (.csv/.xlsx)">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {label}
      </button>
      {msg && <p className="text-xs text-[#64748b] mt-1">{msg}</p>}

      {rows && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setRows(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#edf0f4] sticky top-0 bg-white rounded-t-2xl">
              <div><h3 className="text-sm font-bold text-[#111827]">Match columns</h3><p className="text-xs text-[#9aa2af] mt-0.5">{fileName} · {rows.length.toLocaleString()} rows</p></div>
              <button onClick={() => setRows(null)} className="p-2 rounded-lg hover:bg-[#f6f7f9] text-[#9aa2af]"><X size={18} /></button>
            </div>
            <div className="p-6">
              <p className="text-xs text-[#6b7280] mb-4">We auto-matched your file&apos;s columns. Review each field and adjust if needed. <span className="text-[#b45309] font-medium">* required</span></p>
              <div className="rounded-xl border border-[#edf0f4] overflow-hidden">
                <div className="grid grid-cols-[180px_1fr_150px] items-center gap-3 px-4 py-2 bg-[#f8fafc] border-b border-[#edf0f4] text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                  <div>ChargeGuard field</div><div>Your column</div><div>Sample value</div>
                </div>
                <div className="divide-y divide-[#f1f5f9]">
                  {TARGETS.map((t) => {
                    const sample = mapping[t.key] && rows?.[0] ? String((rows[0] as any)[mapping[t.key]] ?? "") : "";
                    return (
                      <div key={t.key} className="grid grid-cols-[180px_1fr_150px] items-center gap-3 px-4 py-2.5">
                        <div className="text-[13px] font-medium text-[#374151] flex items-center gap-1.5">
                          {mapping[t.key] ? <Check size={14} className="text-[#12b76a] shrink-0" /> : <span className="w-3.5 shrink-0" />}
                          <span>{t.label}{t.req && <span className="text-[#b45309]">*</span>}</span>
                        </div>
                        <select value={mapping[t.key] || ""} onChange={(e) => setMapping({ ...mapping, [t.key]: e.target.value })}
                          className={`w-full h-9 border rounded-lg px-3 text-[13px] focus:outline-none focus:border-[#2563eb] ${t.req && !mapping[t.key] ? "border-[#f4b6b6] bg-[#fdeceb]" : "border-[#e2e6ec]"}`}>
                          <option value="">— Not mapped —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <div className="text-[12px] text-[#94a3b8] truncate" title={sample}>{sample || "—"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t border-[#edf0f4] sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setRows(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">Cancel</button>
              <button onClick={runImport} disabled={busy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-50 flex items-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Import {rows.length.toLocaleString()} rows
              </button>
            </div>
          </div>
        </div>
      )}

      {syncPrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6">
            <h3 className="text-sm font-bold text-[#111827] mb-1.5">Approved changes still missing</h3>
            <p className="text-[13px] text-[#4b5563] mb-4">
              This new CDM upload doesn't include <span className="font-semibold">{syncPrompt.missing}</span> change{syncPrompt.missing === 1 ? "" : "s"} you approved in a prior review. Would you like to re-apply {syncPrompt.missing === 1 ? "it" : "them"} to this review so they're recommended again?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setSyncPrompt(null); router.refresh(); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e6ec] text-[#374151] hover:bg-[#f6f7f9]">Skip</button>
              <button onClick={reapplyMissing} disabled={syncBusy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#1f6fd4] text-white hover:bg-[#1a5fb8] disabled:opacity-50 flex items-center gap-2">
                {syncBusy && <Loader2 size={14} className="animate-spin" />} Re-apply {syncPrompt.missing}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
