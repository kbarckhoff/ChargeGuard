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
      if (!res.ok) {
        setError(data.error || "Scan failed");
      } else {
        setResult(data);
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={runScan}
        disabled={scanning}
        className="flex items-center gap-2 px-4 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a] transition-colors disabled:opacity-50"
      >
        {scanning ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Scanning {">"}40K items…
          </>
        ) : (
          <>
            <Zap size={15} />
            Run CDM Scan
          </>
        )}
      </button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="p-4 bg-white rounded-xl border border-[#e5e5e0] space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <span className="text-sm font-medium text-[#1a1a18]">Scan Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#f5f5f0] rounded-lg">
              <div className="text-xs text-[#7a7a75]">Items Scanned</div>
              <div className="text-lg font-semibold text-[#1a1a18]">{result.itemsScanned.toLocaleString()}</div>
            </div>
            <div className="p-3 bg-[#f5f5f0] rounded-lg">
              <div className="text-xs text-[#7a7a75]">Issues Found</div>
              <div className="text-lg font-semibold text-[#1a1a18] flex items-center gap-1.5">
                {result.findingsGenerated > 0 && <AlertTriangle size={14} className="text-amber-500" />}
                {result.findingsGenerated.toLocaleString()}
              </div>
            </div>
          </div>
          {Object.keys(result.summary).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[#7a7a75] mt-2">Breakdown by Rule</div>
              {Object.entries(result.summary)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([ruleId, info]) => (
                  <div key={ruleId} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg bg-[#fafaf8]">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            info.severity === "critical" ? "#dc2626" :
                            info.severity === "high" ? "#ea580c" :
                            info.severity === "medium" ? "#ca8a04" :
                            info.severity === "low" ? "#2563eb" : "#6b7280",
                        }}
                      />
                      <span className="text-[#3d3d3a]">Rule {ruleId}</span>
                    </div>
                    <span className="font-medium text-[#1a1a18]">{info.count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
