"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, Check, Loader2, Copy } from "lucide-react";

type Row = { id: string; name: string; members: number };

export function AdminClients({ rows, activeOrgId }: { rows: Row[]; activeOrgId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ text: string; temp?: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setErr(""); setMsg(null);
    try {
      const res = await fetch("/api/admin/create-client", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospital_name: name, admin_email: email, admin_name: adminName }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Could not create hospital"); setBusy(false); return; }
      setMsg({
        text: d.emailed
          ? `Created ${d.org?.name}. Sign-in instructions emailed to ${d.admin_email}. You're now working in this hospital.`
          : `Created ${d.org?.name}. Email isn't configured yet, so share this temporary password with ${d.admin_email} securely:`,
        temp: d.tempPassword,
      });
      setName(""); setEmail(""); setAdminName(""); setBusy(false); setOpen(false);
      router.refresh();
    } catch (e: any) { setErr(e?.message || "Something went wrong"); setBusy(false); }
  };

  const switchTo = async (id: string) => {
    if (id === activeOrgId) return;
    setSwitching(id);
    await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: id }) });
    setSwitching(null);
    router.refresh();
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setOpen((v) => !v); setMsg(null); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a]">
          <Plus size={15} /> New hospital
        </button>
      </div>

      {msg && (
        <div className="mb-4 p-3 bg-[#e7f7ef] border border-[#bbe9d1] rounded-xl text-[13px] text-[#067647]">
          {msg.text}
          {msg.temp && (
            <span className="ml-2 inline-flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-white border border-[#bbe9d1] text-[#0f172a] font-mono">{msg.temp}</code>
              <button onClick={() => navigator.clipboard?.writeText(msg.temp!)} className="inline-flex items-center gap-1 text-[#0f172a] underline"><Copy size={11} /> copy</button>
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="mb-6 p-5 rounded-xl border border-[#e2e8f0] bg-white">
          {err && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Hospital name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Northlake Regional Medical Center"
                className="w-full px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Administrator name (optional)</label>
              <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Jane Smith"
                className="w-full px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Administrator email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@hospital.org"
                className="w-full px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
              <p className="text-[12px] text-[#94a3b8] mt-1">They'll be emailed a temporary password and sign-in link, and set their own password on first login.</p>
            </div>
          </div>
          <div className="mt-4">
            <button disabled={busy || !name || !email} onClick={create}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a] disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Create hospital & invite admin
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e2e8f0] divide-y divide-[#eef2f7]">
        {rows.length === 0 && <div className="px-4 py-6 text-[13px] text-[#94a3b8]">No hospitals yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#eff4ff] flex items-center justify-center shrink-0"><Building2 size={16} className="text-[#1e293b]" /></div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-[#0f172a] truncate flex items-center gap-2">
                  <Link href={`/admin/${r.id}`} className="hover:underline hover:text-[#1e293b]">{r.name}</Link>
                  {r.id === activeOrgId && <span className="text-[10px] font-semibold text-[#067647] bg-[#e7f7ef] px-1.5 py-0.5 rounded">ACTIVE</span>}
                </div>
                <div className="text-[12px] text-[#94a3b8]">{r.members} {r.members === 1 ? "user" : "users"}</div>
              </div>
            </div>
            {r.id === activeOrgId ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-[#067647] font-medium"><Check size={14} /> Working here</span>
            ) : (
              <button onClick={() => switchTo(r.id)} disabled={switching === r.id}
                className="text-[12px] text-[#1e293b] font-medium hover:underline inline-flex items-center gap-1">
                {switching === r.id ? <Loader2 size={12} className="animate-spin" /> : null} Switch to this hospital
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
