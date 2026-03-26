"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";

export function CreateAuditForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/audits/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospital_name: form.get("hospital_name"),
          name: form.get("name"),
          description: form.get("description") || null,
          start_date: form.get("start_date"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create audit");
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a]">
        <Plus size={15} /> New Audit
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e5e5e0] p-6 shadow-sm max-w-md mx-auto mt-4">
      <h2 className="text-lg font-semibold text-[#1a1a18] mb-4">Create New Audit</h2>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Hospital Name</label>
          <input name="hospital_name" required
            className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
            placeholder="Mercy General Hospital" />
        </div>
        <div>
          <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Audit Name</label>
          <input name="name" required
            className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
            placeholder="CDM Comprehensive Review 2026" />
        </div>
        <div>
          <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Description (optional)</label>
          <textarea name="description" rows={2}
            className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
            placeholder="Annual charge master review…" />
        </div>
        <div>
          <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Start Date</label>
          <input name="start_date" type="date" defaultValue={new Date().toISOString().split("T")[0]}
            className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setOpen(false)}
            className="px-4 py-2.5 text-sm text-[#5a5a55] hover:bg-[#f5f5f0] rounded-xl">Cancel</button>
          <button type="submit" disabled={loading}
            className="px-5 py-2.5 bg-[#1a1a18] text-white rounded-xl text-sm font-medium hover:bg-[#2d2d2a] disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 size={15} className="animate-spin" />}
            Create Audit
          </button>
        </div>
      </form>
    </div>
  );
}
