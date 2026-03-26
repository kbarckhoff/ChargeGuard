"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAudit } from "@/app/actions";
import { Plus, X, Loader2 } from "lucide-react";

export function NewAuditDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const formData = new FormData(e.currentTarget);
      const auditId = await createAudit(formData);
      setOpen(false);
      router.push(`/audits/${auditId}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create audit");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a] transition-colors"
      >
        <Plus size={15} /> New Audit
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e0]">
          <h2 className="text-lg font-semibold text-[#1a1a18]">Create New Audit</h2>
          <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-[#f5f5f0] rounded-lg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Hospital Name</label>
            <input
              name="hospital_name"
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="Mercy General Hospital"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Audit Name</label>
            <input
              name="name"
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
              placeholder="CDM Comprehensive Review 2026"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Description (optional)</label>
            <textarea
              name="description"
              rows={2}
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10 resize-none"
              placeholder="Annual comprehensive charge master review…"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Start Date</label>
            <input
              name="start_date"
              type="date"
              defaultValue={new Date().toISOString().split("T")[0]}
              className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
            />
          </div>

          <div className="p-3 bg-[#f5f5f0] rounded-xl text-xs text-[#7a7a75]">
            This will automatically create 7 audit phases with 62 pre-configured tasks from the PARA CDM audit process.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-sm font-medium text-[#5a5a55] hover:bg-[#f5f5f0] rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#1a1a18] text-white rounded-xl text-sm font-medium hover:bg-[#2d2d2a] disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              Create Audit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
