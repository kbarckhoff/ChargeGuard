"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { parseRemit } from "@/lib/remit-parser";

// Import an 835 electronic remittance (ERA) or a remit CSV. Feeds the Phase-B
// cross-file joins: first-pass yield, denial rate, net collection yield, and the
// denial → CDM root-cause trace.
export function RemitImport({ auditId, label = "Import Remittance (835)" }: { auditId: string; label?: string }) {
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
      const { claims, lines, format, meta } = parseRemit(text);
      if (claims.length === 0 && lines.length === 0) {
        setMsg("No remittance found. Expecting an 835 (.835/.era/.txt) or a remit CSV.");
        setBusy(false);
        return;
      }
      const r = await fetch("/api/import-remit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, claims, lines, replace: true }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg("Failed: " + (j.error || r.status)); setBusy(false); return; }
      setMsg(`Imported ${(j.lines || 0).toLocaleString()} remit lines from ${(j.claims || meta.claims).toLocaleString()} claim(s) (${format.toUpperCase()}). Re-run the scan to compute yield, denials, and the denial → CDM trace.`);
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
      <input ref={fileRef} type="file" accept=".835,.era,.dat,.txt,.edi,.csv,.x12" onChange={onFile} className="hidden" />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] disabled:opacity-50"
        title="Import an 835 electronic remittance (ERA) or a remit CSV for the Phase-B claims joins"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {label}
      </button>
      {msg && <p className="text-xs text-[#64748b] mt-1">{msg}</p>}
    </div>
  );
}
