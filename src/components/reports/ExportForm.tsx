"use client";

import { useState } from "react";
import { Loader2, FileSpreadsheet } from "lucide-react";

export function ExportForm({
  auditId,
  totalFindings,
}: {
  auditId: string;
  totalFindings: number;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ auditId, format: "xlsx" });
      const res = await fetch(`/api/export?${params.toString()}`);
      if (!res.ok) {
        alert("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || "report.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Export failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (totalFindings === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
        <h3 className="text-sm font-semibold text-[#334155] mb-2">Export CDM Analysis Report</h3>
        <p className="text-sm text-[#64748b]">No findings yet. Once a review has run, you can download the full Excel report here.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
      <h3 className="text-sm font-semibold text-[#334155] mb-4">Export CDM Analysis Report</h3>
      <p className="text-sm text-[#64748b] mb-5">
        The <strong>Excel report</strong> is the full deliverable — Executive Summary, Impact Analysis, Dept Revenue Summary, a
        tab per flag category, and the Hospital CDM + All Flags master.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExport}
          disabled={downloading}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1e293b] text-white rounded-lg text-sm font-medium hover:bg-[#0f172a] disabled:opacity-50 shadow-sm"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Download Excel Report
        </button>
      </div>
    </div>
  );
}
