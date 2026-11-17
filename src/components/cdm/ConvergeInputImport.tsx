"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { parseClaimsExtract, parseItemMaster, parseGlDepartments } from "@/lib/converge-inputs-parser";

type Kind = "claims-extract" | "item-master" | "gl";

const CONFIG: Record<Kind, { label: string; endpoint: string; parse: (t: string) => { rows: any[]; meta: { rows: number } }; title: string; after?: string }> = {
  "claims-extract": {
    label: "Import Claims Extract", endpoint: "/api/import-claims-extract", parse: parseClaimsExtract,
    title: "De-identified claims extract (claim number, HCPCS, billed/allowed/paid, denial/CARC, RARC, payer)",
    after: " Re-run the scan to compute yield, denials, and the denial → CDM trace.",
  },
  "item-master": {
    label: "Import Item Master", endpoint: "/api/import-item-master", parse: parseItemMaster,
    title: "Hospital item master (item #, description, HCPCS, rev code, C-code, device flag, charge code)",
    after: " Re-run the scan to check device / C-code / rev-code setup against the CDM.",
  },
  "gl": {
    label: "Import GL / Departments", endpoint: "/api/import-gl", parse: parseGlDepartments,
    title: "Finance GL / department list (GL number, department name, charge-code prefix)",
  },
};

export function ConvergeInputImport({ auditId, kind }: { auditId: string; kind: Kind }) {
  const cfg = CONFIG[kind];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg("Reading file…");
    try {
      const text = await file.text();
      const { rows, meta } = cfg.parse(text);
      if (rows.length === 0) { setMsg("No usable rows found. Expecting a CSV export."); setBusy(false); return; }
      const CHUNK = 1000;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await fetch(cfg.endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auditId, rows: rows.slice(i, i + CHUNK), replace: i === 0 }),
        });
        const j = await r.json();
        if (!r.ok) { setMsg("Failed: " + (j.error || r.status)); setBusy(false); return; }
        inserted += j.inserted || 0;
        setMsg(`Importing… ${inserted.toLocaleString()} rows`);
      }
      setMsg(`Imported ${inserted.toLocaleString()} of ${meta.rows.toLocaleString()} rows.${cfg.after || ""}`);
      router.refresh();
    } catch (err: any) {
      setMsg("Failed: " + err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col items-stretch">
      <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
        title={cfg.title}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {cfg.label}
      </button>
      {msg && <p className="text-xs text-[#64748b] mt-1">{msg}</p>}
    </div>
  );
}
