"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Check, UserPlus, Copy, Building2 } from "lucide-react";

type Member = { id: string; name: string; email: string; role: string; active: boolean };
type Dept = { id: string; name: string };
type Org = { id: string; name: string; contact_email: string };

export function AdminClientDetail({ org, members, departments, isActive }: { org: Org; members: Member[]; departments: Dept[]; isActive: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(org.name);
  const [email, setEmail] = useState(org.contact_email);
  const [savedMsg, setSavedMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; temp?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(""); setSavedMsg("");
    const res = await fetch("/api/admin/client", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: org.id, name, contact_email: email }) });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(d.error || "Could not save"); return; }
    setSavedMsg("Saved."); router.refresh();
  };

  const switchTo = async () => {
    await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: org.id }) });
    router.refresh();
  };

  const invite = async () => {
    setInviting(true); setInviteMsg(null); setErr("");
    const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail, org_id: org.id }) });
    const d = await res.json().catch(() => ({}));
    setInviting(false);
    if (!res.ok) { setErr(d.error || "Could not invite"); return; }
    setInviteMsg(d.tempPassword ? { text: `Added ${inviteEmail}. Email isn't configured, share this temp password:`, temp: d.tempPassword } : { text: `Invited ${inviteEmail} — a temp password was emailed.` });
    setInviteEmail(""); router.refresh();
  };

  const toggleActive = async (m: Member) => {
    setBusyId(m.id);
    await fetch("/api/team/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: m.id, is_active: !m.active }) });
    setBusyId(null); router.refresh();
  };

  return (
    <div>
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-[13px] text-[#1e293b] hover:underline mb-4"><ArrowLeft size={14} /> All hospitals</Link>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#eff4ff] flex items-center justify-center"><Building2 size={20} className="text-[#1e293b]" /></div>
          <div>
            <h1 className="text-xl font-semibold text-[#0f172a] flex items-center gap-2">{org.name}{isActive && <span className="text-[10px] font-semibold text-[#067647] bg-[#e7f7ef] px-1.5 py-0.5 rounded">ACTIVE</span>}</h1>
            <p className="text-[12px] text-[#94a3b8]">{members.length} {members.length === 1 ? "user" : "users"} · {departments.length} departments</p>
          </div>
        </div>
        {isActive ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-[#067647] font-medium"><Check size={15} /> Working here</span>
        ) : (
          <button onClick={switchTo} className="px-3.5 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a]">Switch to this hospital</button>
        )}
      </div>

      {err && <div className="mb-4 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}

      {/* Details */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5 mb-5">
        <h2 className="text-[13px] font-semibold text-[#334155] mb-3">Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[#64748b] block mb-1">Hospital name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[#64748b] block mb-1">Contact email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a] disabled:opacity-50">{saving && <Loader2 size={13} className="animate-spin" />} Save changes</button>
          {savedMsg && <span className="text-[13px] text-[#067647]">{savedMsg}</span>}
        </div>
      </div>

      {/* Users */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5 mb-5">
        <h2 className="text-[13px] font-semibold text-[#334155] mb-3">Users</h2>
        <div className="divide-y divide-[#eef2f7]">
          {members.length === 0 && <div className="text-[13px] text-[#94a3b8] py-2">No users yet.</div>}
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="text-[13.5px] text-[#0f172a] font-medium truncate flex items-center gap-2">
                  {m.name || m.email}
                  {m.role && <span className="text-[10px] uppercase tracking-wide text-[#475569] bg-[#f1f5f9] px-1.5 py-0.5 rounded">{m.role}</span>}
                  {!m.active && <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded">DEACTIVATED</span>}
                </div>
                <div className="text-[12px] text-[#94a3b8] truncate">{m.email}</div>
              </div>
              <button onClick={() => toggleActive(m)} disabled={busyId === m.id} className="text-[12px] text-[#64748b] hover:underline shrink-0">{m.active ? "Deactivate" : "Reactivate"}</button>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-[#eef2f7]">
          {inviteMsg && (
            <div className="mb-3 p-2.5 bg-[#e7f7ef] border border-[#bbe9d1] rounded-lg text-[13px] text-[#067647]">
              {inviteMsg.text}
              {inviteMsg.temp && (
                <span className="ml-2 inline-flex items-center gap-2">
                  <code className="px-1.5 py-0.5 rounded bg-white border border-[#bbe9d1] text-[#0f172a] font-mono">{inviteMsg.temp}</code>
                  <button onClick={() => navigator.clipboard?.writeText(inviteMsg.temp!)} className="inline-flex items-center gap-1 text-[#0f172a] underline"><Copy size={11} /> copy</button>
                </span>
              )}
            </div>
          )}
          <label className="text-[12px] font-medium text-[#64748b] block mb-1">Add a user to this hospital</label>
          <div className="flex items-center gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@hospital.org" className="flex-1 px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" />
            <button onClick={invite} disabled={inviting || !inviteEmail} className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a] disabled:opacity-50">{inviting ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={14} />} Invite</button>
          </div>
        </div>
      </div>

      {/* Departments */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
        <h2 className="text-[13px] font-semibold text-[#334155] mb-3">Departments</h2>
        <div className="flex flex-wrap gap-1.5">
          {departments.length === 0 && <span className="text-[13px] text-[#94a3b8]">No departments.</span>}
          {departments.map((d) => (<span key={d.id} className="px-2.5 py-1 rounded-full text-[12px] bg-[#f1f5f9] text-[#475569]">{d.name}</span>))}
        </div>
      </div>
    </div>
  );
}
