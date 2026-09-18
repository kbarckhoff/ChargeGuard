"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export function ScanButton({ auditId }: { auditId: string }) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{
    itemsScanned: number;
    findingsGenerated: number;
    summary: Record<string, { count: number; severity: string }>;
  } | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  const runScan = async () => {
    setScanning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Scan failed");
      else { setResult(data); router.refresh(); }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const dot = (sev: string) =>
    sev === "critical" ? "#dc2626" :
    sev === "high" ? "#ea580c" :
    sev === "medium" ? "#ca8a04" :
    sev === "low" ? "#1e293b" : "#6b7280";

  return (
    <div className="space-y-4">
      <button
        onClick={runScan}
        disabled={scanning}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e293b] text-white rounded-lg text-sm font-medium hover:bg-[#0f172a] transition-colors disabled:opacity-50 shadow-sm"
      >
        {scanning ? (<><Loader2 size={15} className="animate-spin" />Scanning…</>) : (<><Zap size={15} />Run CDM Scan</>)}
      </button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <span className="text-sm font-semibold text-[#0f172a]">Scan Complete</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-[#f1f5f9] rounded-lg">
              <div className="text-xs text-[#64748b]">Items Scanned</div>
              <div className="text-lg font-semibold text-[#0f172a]">{result.itemsScanned.toLocaleString()}</div>
            </div>
            <div className="p-3 bg-[#f1f5f9] rounded-lg">
              <div className="text-xs text-[#64748b]">Issues Found</div>
              <div className="text-lg font-semibold text-[#0f172a] flex items-center gap-1.5">
                {result.findingsGenerated > 0 && <AlertTriangle size={14} className="text-amber-500" />}
                {result.findingsGenerated.toLocaleString()}
              </div>
            </div>
            <div className="p-3 bg-[#f1f5f9] rounded-lg">
              <div className="text-xs text-[#64748b]">Rules Triggered</div>
              <div className="text-lg font-semibold text-[#0f172a]">{Object.keys(result.summary).length}</div>
            </div>
          </div>

          {Object.keys(result.summary).length > 0 && (
            <div>
              <div className="text-xs font-medium text-[#64748b] mb-2">Breakdown by Rule</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Object.entries(result.summary)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([ruleId, info]) => (
                    <div key={ruleId} className="flex items-center justify-between text-sm py-1.5 px-2.5 rounded-lg bg-[#f4f6f8]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot(info.severity) }} />
                        <span className="text-[#334155] truncate">Rule {ruleId}</span>
                      </div>
                      <span className="font-medium text-[#0f172a] flex-shrink-0">{info.count.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
