"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Upload, Loader2 } from "lucide-react";

export function FormularyImport({ auditId, label = "Import Formulary" }: { auditId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        try {
          const all = (res.data as any[]).filter((r) => r && Object.keys(r).length);
          const CHUNK = 500;
          let inserted = 0;
          for (let i = 0; i < all.length; i += CHUNK) {
            const r = await fetch("/api/import-formulary", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auditId, rows: all.slice(i, i + CHUNK), replace: i === 0 }),
            });
            const j = await r.json();
            if (!r.ok) { setMsg("Failed: " + (j.error || r.status)); setBusy(false); return; }
            inserted += j.inserted || 0;
            setMsg(`Importing… ${inserted.toLocaleString()} rows`);
          }
          setMsg(`Imported formulary for ${inserted.toLocaleString()} drugs.`);
          router.refresh();
        } catch (err: any) { setMsg("Failed: " + err.message); }
        finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
      },
    });
  };

  return (
    <div className="flex flex-col items-stretch">
      <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
        title="Import pharmacy formulary / drug master (status, NDC, package) by charge code">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {label}
      </button>
      {msg && <p className="text-xs text-[#64748b] mt-1">{msg}</p>}
    </div>
  );
}
