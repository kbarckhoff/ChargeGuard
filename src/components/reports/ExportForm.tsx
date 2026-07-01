"use client";

import { useState } from "react";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";

export function ExportForm({
  auditId,
  totalFindings,
}: {
  auditId: string;
  totalFindings: number;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async (fmt: "csv" | "xlsx" = "csv") => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ auditId, format: fmt });
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

  const handleDataRequest = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/data-request?auditId=${auditId}`);
      if (!res.ok) { alert("Failed to generate data request"); return; }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || "Client_Data_Request.xlsx";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) { alert("Failed: " + err.message); } finally { setDownloading(false); }
  };

  const dataRequestBtn = (
    <button
      onClick={handleDataRequest}
      disabled={downloading}
      className="flex items-center gap-2 px-5 py-2.5 bg-white border border-[#e5e5e0] text-[#3d3d3a] rounded-lg text-sm font-medium hover:bg-[#f5f5f0] disabled:opacity-50"
    >
      {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
      Download Client Data Request
    </button>
  );

  if (totalFindings === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
        <h3 className="text-sm font-semibold text-[#3d3d3a] mb-2">Client Data Request</h3>
        <p className="text-sm text-[#7a7a75] mb-4">No findings yet — but you can still generate the client data request to collect the CDM, R&U, and supporting files before the review.</p>
        {dataRequestBtn}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
      <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Export CDM Analysis Report</h3>
      <p className="text-sm text-[#7a7a75] mb-5">
        <strong>Excel report</strong> is the full deliverable — Executive Summary, Impact Analysis, Dept Revenue Summary, a
        tab per flag category, and the Hospital CDM + All Flags master. <strong>CSV</strong> is a flat list of every finding.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleExport("xlsx")}
          disabled={downloading}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a] disabled:opacity-50"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          Download Excel Report
        </button>
        <button
          onClick={() => handleExport("csv")}
          disabled={downloading}
          className="flex items-center gap-2 px-5 py-2.5 bg-white border border-[#e5e5e0] text-[#3d3d3a] rounded-lg text-sm font-medium hover:bg-[#f5f5f0] disabled:opacity-50"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Download CSV
        </button>
        {dataRequestBtn}
      </div>
    </div>
  );
}
