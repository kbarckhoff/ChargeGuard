"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CDMColorDot, CDM_COLORS, Badge, EmptyState } from "@/components/ui/shared";
import { Search, Upload, Download, X, Check, CheckCircle2, FileSpreadsheet, ChevronLeft, Loader2 } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { CDM_TARGET_COLUMNS } from "@/types";

export function CDMTable({
  items,
  total,
  page,
  totalPages,
  search,
  colorFilter,
  auditId,
}: {
  items: any[];
  total: number;
  page: number;
  totalPages: number;
  search: string;
  colorFilter: string;
  auditId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showMapper, setShowMapper] = useState(false);

  const updateParams = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== "page") params.delete("page"); // reset page on filter change
    router.push(`/charge-master?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* CDM Color Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {Object.entries(CDM_COLORS)
          .filter(([k]) => k !== "none")
          .map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
              <span className="text-xs text-[#5a5a55]">{cfg.label}</span>
            </div>
          ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a95]" />
          <input
            type="text"
            defaultValue={search}
            onChange={(e) => {
              clearTimeout((window as any).__cdmSearchTimeout);
              (window as any).__cdmSearchTimeout = setTimeout(() => updateParams("search", e.target.value), 400);
            }}
            placeholder="Search by description, HCPCS, or proc number…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#e5e5e0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
          />
        </div>
        <select
          value={colorFilter}
          onChange={(e) => updateParams("color", e.target.value)}
          className="text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="red">🔴 Invalid</option>
          <option value="blue">🔵 Filter Match</option>
          <option value="green">🟢 Recommended</option>
          <option value="purple">🟣 Advisory</option>
          <option value="none">⚪ No Issues</option>
        </select>
        <button
          onClick={() => setShowMapper(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a]"
        >
          <Upload size={14} /> Import CSV
        </button>
      </div>

      {/* Table */}
      {total === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No charge items"
          description="Import your hospital's charge master CSV to populate this table."
          action={
            <button
              onClick={() => setShowMapper(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium"
            >
              <Upload size={14} /> Import CSV
            </button>
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-[#e5e5e0] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafaf8] border-b border-[#e5e5e0]">
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs w-8" />
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Proc #</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Description</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">HCPCS/CPT</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Rev Code</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Dept</th>
                  <th className="px-3 py-2.5 text-right font-medium text-[#5a5a55] text-xs">Gross Charge</th>
                  <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Mod</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[#f5f5f0] hover:bg-[#fafaf8] transition-colors"
                    style={item.cdm_color !== "none" ? { backgroundColor: CDM_COLORS[item.cdm_color]?.bg } : {}}
                  >
                    <td className="px-3 py-2"><CDMColorDot color={item.cdm_color} /></td>
                    <td className="px-3 py-2 text-[#5a5a55]">{item.procedure_number}</td>
                    <td
                      className="px-3 py-2 font-medium max-w-[250px] truncate"
                      style={
                        item.cdm_color === "red" ? { color: "#dc2626" } :
                        item.cdm_color === "green" ? { color: "#16a34a" } :
                        item.cdm_color === "purple" ? { color: "#9333ea" } :
                        { color: "#3d3d3a" }
                      }
                    >
                      {item.charge_description}
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-xs"
                      style={
                        item.cdm_color === "red" ? { color: "#dc2626", fontWeight: 600 } :
                        item.cdm_color === "blue" ? { color: "#2563eb", fontWeight: 600 } :
                        { color: "#3d3d3a" }
                      }
                    >
                      {item.hcpcs_cpt_code}
                    </td>
                    <td className="px-3 py-2 text-[#5a5a55]">{item.revenue_code}</td>
                    <td className="px-3 py-2 text-[#5a5a55] text-xs">{item.department}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#3d3d3a]">
                      {item.gross_charge ? `$${Number(item.gross_charge).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#7a7a75]">{item.modifier_1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e5e0] bg-[#fafaf8]">
            <span className="text-xs text-[#9a9a95]">
              {total.toLocaleString()} items • Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateParams("page", String(Math.max(1, page - 1)))}
                disabled={page === 1}
                className="px-3 py-1 text-xs border border-[#e5e5e0] rounded-lg hover:bg-white disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => updateParams("page", String(Math.min(totalPages, page + 1)))}
                disabled={page === totalPages}
                className="px-3 py-1 text-xs border border-[#e5e5e0] rounded-lg hover:bg-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showMapper && (
        <CSVImportModal auditId={auditId} onClose={() => setShowMapper(false)} />
      )}
    </div>
  );
}

// ─── CDM Import Modal ────────────────────────────────────────

function CSVImportModal({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; errors?: string[] } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savedConfigs, setSavedConfigs] = useState<{ id: string; name: string; column_mappings: Record<string, string> }[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Load saved mappings on mount
  useEffect(() => {
    setLoadingConfigs(true);
    fetch("/api/import-configs")
      .then((r) => r.json())
      .then((data) => setSavedConfigs(data.configs || []))
      .catch(() => {})
      .finally(() => setLoadingConfigs(false));
  }, []);

  const processData = (h: string[], data: Record<string, string>[]) => {
    setHeaders(h);
    setAllRows(data);
    setRows(data.slice(0, 5));

    // Auto-map by fuzzy matching
    const autoMap: Record<string, string> = {};
    CDM_TARGET_COLUMNS.forEach((tc) => {
      const match = h.find((hh) => {
        const hl = hh.toLowerCase().trim();
        const tl = tc.label.toLowerCase();
        const tk = tc.key.toLowerCase().replace(/_/g, " ");
        return hl === tl || hl === tk || hl.includes(tk) || tl.includes(hl);
      });
      if (match) autoMap[tc.key] = match;
    });
    setMappings(autoMap);
    setStep(2);
  };

  const applySavedMapping = (config: { column_mappings: Record<string, string> }) => {
    // Apply saved mapping — only set if the source column exists in current headers
    const applied: Record<string, string> = {};
    Object.entries(config.column_mappings).forEach(([targetCol, sourceCol]) => {
      if (sourceCol && headers.includes(sourceCol)) {
        applied[targetCol] = sourceCol;
      }
    });
    setMappings(applied);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const h = results.meta.fields || [];
          processData(h, results.data as Record<string, string>[]);
        },
      });
    } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target?.result;
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
            raw: false,
            defval: "",
          });
          if (jsonData.length === 0) {
            alert("No data found in the spreadsheet.");
            return;
          }
          const h = Object.keys(jsonData[0]);
          processData(h, jsonData);
        } catch (err: any) {
          alert("Failed to parse Excel file: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert("Unsupported file type. Please upload a .csv, .xlsx, or .xls file.");
    }
  };

  const requiredMet = CDM_TARGET_COLUMNS.filter((c) => c.required).every((c) => mappings[c.key]);
  const [importProgress, setImportProgress] = useState("");

  const handleImport = async () => {
    setImporting(true);
    setImportProgress("Starting import…");
    try {
      const CHUNK_SIZE = 5000; // Stay well under Vercel's 4.5MB body limit
      let totalInserted = 0;
      const allErrors: string[] = [];
      const totalChunks = Math.ceil(allRows.length / CHUNK_SIZE);

      for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
        const chunk = allRows.slice(i, i + CHUNK_SIZE);
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
        setImportProgress(`Uploading batch ${chunkNum} of ${totalChunks} (${Math.min(i + CHUNK_SIZE, allRows.length).toLocaleString()} / ${allRows.length.toLocaleString()} rows)…`);

        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auditId,
            items: chunk,
            columnMappings: mappings,
            // Only save mapping on the first chunk
            saveMappingAs: i === 0 ? (saveName || undefined) : undefined,
          }),
        });

        if (!res.ok) {
          let errMsg = "Unknown error";
          try {
            const data = await res.json();
            errMsg = `${data.error}${data.detail ? " — " + data.detail : ""}`;
          } catch {
            errMsg = `HTTP ${res.status}: ${res.statusText}`;
          }
          allErrors.push(`Batch ${chunkNum}: ${errMsg}`);
          continue; // Continue with remaining batches
        }

        const data = await res.json();
        totalInserted += data.inserted || 0;
        if (data.errors) allErrors.push(...data.errors);
      }

      setResult({ inserted: totalInserted, errors: allErrors.length > 0 ? allErrors : undefined });
      setStep(4);
      router.refresh();
    } catch (err: any) {
      alert("Import failed: " + err.message);
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e0]">
          <div>
            <h2 className="text-lg font-semibold text-[#1a1a18]">Import Charge Master</h2>
            <p className="text-sm text-[#7a7a75]">
              {step === 1 ? "Upload file" : step === 2 ? "Map columns" : step === 3 ? "Review & confirm" : "Import complete"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#f5f5f0] rounded-lg"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-[#f5f5f0] flex items-center justify-center mb-4">
                <Upload size={28} className="text-[#5a5a55]" />
              </div>
              <p className="text-[#3d3d3a] font-medium mb-1">Upload your hospital&apos;s CDM export</p>
              <p className="text-sm text-[#9a9a95] mb-4">Supports .xlsx, .xls, and .csv files</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden" onChange={handleFile} />
              <button onClick={() => fileRef.current?.click()}
                className="px-5 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a]">
                Choose File
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[#7a7a75]">
                  {headers.length} columns detected • {allRows.length.toLocaleString()} rows
                </p>
                {/* Saved Mappings Dropdown */}
                {savedConfigs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#9a9a95]">Load saved:</span>
                    <select
                      onChange={(e) => {
                        const config = savedConfigs.find((c) => c.id === e.target.value);
                        if (config) applySavedMapping(config);
                      }}
                      className="text-sm border border-[#e5e5e0] rounded-lg px-2 py-1 bg-white focus:outline-none"
                      defaultValue=""
                    >
                      <option value="" disabled>Select mapping…</option>
                      {savedConfigs.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {CDM_TARGET_COLUMNS.map((tc) => (
                <div key={tc.key} className="flex items-center gap-3 py-2 px-3 rounded-lg border border-[#e5e5e0] bg-[#fafaf8]">
                  <div className="w-44 flex items-center gap-2">
                    <span className="text-sm font-medium text-[#3d3d3a]">{tc.label}</span>
                    {tc.required && <span className="text-[10px] text-red-500 font-medium">REQ</span>}
                  </div>
                  <ChevronLeft size={14} className="text-[#c5c5c0] rotate-180" />
                  <select
                    value={mappings[tc.key] || ""}
                    onChange={(e) => setMappings((m) => ({ ...m, [tc.key]: e.target.value || "" }))}
                    className="flex-1 text-sm border border-[#e5e5e0] rounded-lg px-3 py-1.5 bg-white focus:outline-none"
                  >
                    <option value="">— Skip —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {mappings[tc.key] && rows[0] && (
                    <span className="text-xs text-[#9a9a95] w-28 truncate">
                      e.g. &quot;{rows[0][mappings[tc.key]]}&quot;
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  <span className="font-medium text-emerald-800 text-sm">Ready to import</span>
                </div>
                <p className="text-sm text-emerald-700">
                  {Object.keys(mappings).filter((k) => mappings[k]).length} columns mapped •{" "}
                  {allRows.length.toLocaleString()} rows
                </p>
              </div>

              {/* Save Mapping Option */}
              <div className="flex items-center gap-3 p-3 border border-[#e5e5e0] rounded-xl bg-[#fafaf8]">
                <span className="text-sm text-[#5a5a55] whitespace-nowrap">Save this mapping as:</span>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. Hoag CDM Format"
                  className="flex-1 text-sm border border-[#e5e5e0] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
                />
              </div>

              <div className="overflow-x-auto border border-[#e5e5e0] rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#fafaf8]">
                      {CDM_TARGET_COLUMNS.filter((c) => mappings[c.key]).map((c) => (
                        <th key={c.key} className="px-3 py-2 text-left font-medium text-[#5a5a55] text-xs">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, ri) => (
                      <tr key={ri} className="border-t border-[#f0f0ec]">
                        {CDM_TARGET_COLUMNS.filter((c) => mappings[c.key]).map((c) => (
                          <td key={c.key} className="px-3 py-2 text-[#3d3d3a]">{row[mappings[c.key]] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
                <Check size={28} className="text-emerald-600" />
              </div>
              <p className="text-lg font-semibold text-[#1a1a18] mb-1">Import Complete</p>
              <p className="text-sm text-[#7a7a75]">{result?.inserted.toLocaleString()} charge items imported successfully.</p>
              {result?.errors && result.errors.length > 0 && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 max-w-md">
                  {result.errors.length} batch(es) had errors — {result.inserted.toLocaleString()} of {allRows.length.toLocaleString()} rows imported.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#e5e5e0] flex items-center justify-between">
          <div className="flex items-center gap-3">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`w-2 h-2 rounded-full ${step >= s ? "bg-[#1a1a18]" : "bg-[#e5e5e0]"}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step === 4 ? (
              <button onClick={onClose} className="px-5 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium">Done</button>
            ) : (
              <>
                {step > 1 && step < 4 && (
                  <button onClick={() => setStep((s) => s - 1)} className="px-4 py-2 text-sm text-[#5a5a55] hover:bg-[#f5f5f0] rounded-lg">Back</button>
                )}
                {step === 2 && (
                  <button onClick={() => setStep(3)} disabled={!requiredMet}
                    className={`px-5 py-2 text-sm font-medium rounded-lg ${requiredMet ? "bg-[#1a1a18] text-white hover:bg-[#2d2d2a]" : "bg-[#e5e5e0] text-[#9a9a95] cursor-not-allowed"}`}>
                    Preview
                  </button>
                )}
                {step === 3 && (
                  <button onClick={handleImport} disabled={importing}
                    className="px-5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                    {importing ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span className="max-w-[200px] truncate">{importProgress || "Importing…"}</span>
                      </>
                    ) : (
                      <>
                        <Upload size={14} />
                        Import {allRows.length.toLocaleString()} Items
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
