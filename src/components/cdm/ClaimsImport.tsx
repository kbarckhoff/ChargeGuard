"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { parseClaims } from "@/lib/claims-parser";

export function ClaimsImport({ auditId, label = "Import Claims (837)" }: { auditId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg("Reading file…");
    try {
      const text = await file.text();
      const { rows, format, meta } = parseClaims(text);
      if (rows.length === 0) {
        setMsg("No claim lines found. Expecting an 837 (.dat/.txt/.837) or a claim-line CSV.");
        setBusy(false);
        return;
      }
      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const r = await fetch("/api/import-claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auditId, rows: chunk, replace: i === 0 }),
        });
        const j = await r.json();
        if (!r.ok) { setMsg("Failed: " + (j.error || r.status)); setBusy(false); return; }
        inserted += j.inserted || 0;
        setMsg(`Importing… ${inserted.toLocaleString()} lines`);
      }
      setMsg(`Imported ${inserted.toLocaleString()} claim lines from ${meta.claims.toLocaleString()} claim(s) (${format.toUpperCase()}).`);
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
      <input ref={fileRef} type="file" accept=".dat,.txt,.837,.edi,.csv,.x12" onChange={onFile} className="hidden" />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
        title="Import an 837 claims file (837P/837I) or a claim-line CSV for Phase-2 claims checks"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {label}
      </button>
      {msg && <p className="text-xs text-[#64748b] mt-1">{msg}</p>}
    </div>
  );
}
