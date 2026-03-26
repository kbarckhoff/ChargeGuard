"use client";

import { useState } from "react";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";

export function ExportForm({
  auditId,
  categories,
  totalFindings,
}: {
  auditId: string;
  categories: string[];
  totalFindings: number;
}) {
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ auditId });
      if (severity !== "all") params.set("severity", severity);
      if (status !== "all") params.set("status", status);
      if (category !== "all") params.set("category", category);

      const res = await fetch(`/api/export?${params.toString()}`);
      if (!res.ok) {
        alert("Export failed");
        return;
      }

      // Download the file
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || "findings.csv";
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
      <div className="bg-white rounded-xl border border-[#e5e5e0] p-8 text-center">
        <FileSpreadsheet size={24} className="mx-auto text-[#9a9a95] mb-3" />
        <p className="text-sm text-[#9a9a95]">No findings to export. Run a CDM scan first.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
      <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Export Findings Report</h3>
      <p className="text-sm text-[#7a7a75] mb-4">
        Download a CSV file with all findings, including linked charge item details. Filter to export a specific subset.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="text-xs font-medium text-[#7a7a75] block mb-1.5">Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}
            className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white focus:outline-none">
            <option value="all">All Severities</option>
            <option value="critical">Critical only</option>
            <option value="high">High only</option>
            <option value="medium">Medium only</option>
            <option value="low">Low only</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a7a75] block mb-1.5">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white focus:outline-none">
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a7a75] block mb-1.5">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white focus:outline-none">
            <option value="all">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={handleExport}
        disabled={downloading}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a] disabled:opacity-50"
      >
        {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        Download CSV Report
      </button>
    </div>
  );
}
