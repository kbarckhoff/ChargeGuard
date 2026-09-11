"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Check, Loader2, Copy } from "lucide-react";

type Dept = { id: string; name: string };
type Member = { id: string; full_name: string; email: string; is_active: boolean; is_platform_owner: boolean; department_ids: string[] };
type Invite = { id: string; email: string; department_ids: string[] };

export function TeamManager({ members, departments, invites }: { members: Member[]; departments: Dept[]; invites: Invite[] }) {
  const router = useRouter();
  const nameOf = (id: string) => departments.find((d) => d.id === id)?.name || "—";

  // Invite form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pickedDepts, setPickedDepts] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ link?: string; text: string } | null>(null);
  const [inviteErr, setInviteErr] = useState("");

  // Per-member department editing
  const [editing, setEditing] = useState<string | null>(null);
  const [editDepts, setEditDepts] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const sendInvite = async () => {
    setSending(true); setInviteErr(""); setInviteMsg(null);
    try {
      const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, department_ids: pickedDepts }) });
      const d = await res.json();
      if (!res.ok) { setInviteErr(d.error || "Could not send invite"); setSending(false); return; }
      setInviteMsg(d.link ? { link: d.link, text: "Invite created. Email isn't configured, so share this link:" } : { text: `Invite emailed to ${email}.` });
      setEmail(""); setPickedDepts([]); setSending(false);
      router.refresh();
    } catch (e: any) { setInviteErr(e?.message || "Something went wrong"); setSending(false); }
  };

  const saveDepts = async (userId: string) => {
    setSavingId(userId);
    await fetch("/api/team/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, department_ids: editDepts }) });
    setSavingId(null); setEditing(null); router.refresh();
  };

  const setActive = async (userId: string, is_active: boolean) => {
    setSavingId(userId);
    await fetch("/api/team/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, is_active }) });
    setSavingId(null); router.refresh();
  };

  const revoke = async (id: string) => {
    await fetch("/api/team/invite", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  };

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#334155]">Team</h3>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">People here see findings for the departments they belong to. Someone in every department sees everything.</p>
        </div>
        <button onClick={() => setInviteOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-2 bg-[#1f6fd4] text-white rounded-lg text-[13px] font-medium hover:bg-[#1a5fb8]">
          <UserPlus size={14} /> Invite
        </button>
      </div>

      {inviteOpen && (
        <div className="mb-5 p-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
          {inviteErr && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{inviteErr}</div>}
          {inviteMsg && (
            <div className="mb-3 p-2.5 bg-[#e7f7ef] border border-[#bbe9d1] rounded-lg text-[13px] text-[#067647]">
              {inviteMsg.text}
              {inviteMsg.link && (
                <button onClick={() => navigator.clipboard?.writeText(inviteMsg.link!)} className="ml-2 inline-flex items-center gap-1 text-[#0f172a] underline"><Copy size={11} /> copy link</button>
              )}
            </div>
          )}
          <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hospital.org" className="w-full mb-3 px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1f6fd4]/20" />
          <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Departments</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {departments.map((d) => (
              <button key={d.id} onClick={() => setPickedDepts((p) => toggle(p, d.id))} className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${pickedDepts.includes(d.id) ? "bg-[#1f6fd4] text-white border-[#1f6fd4]" : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#cbd5e1]"}`}>{d.name}</button>
            ))}
          </div>
          <button disabled={sending || !email} onClick={sendInvite} className="px-4 py-2 bg-[#1f6fd4] text-white rounded-lg text-[13px] font-medium hover:bg-[#1a5fb8] disabled:opacity-50 inline-flex items-center gap-1.5">
            {sending && <Loader2 size={13} className="animate-spin" />} Send invite
          </button>
        </div>
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8] mb-2">Pending invites</div>
          <div className="space-y-1.5">
            {invites.map((iv) => (
              <div key={iv.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#f8fafc] border border-[#eef2f7]">
                <span className="text-[13px] text-[#334155]">{iv.email}<span className="text-[#94a3b8]"> · {iv.department_ids.map(nameOf).join(", ") || "no departments"}</span></span>
                <button onClick={() => revoke(iv.id)} className="text-[12px] text-[#b42318] hover:underline">Revoke</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members */}
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="px-3 py-2.5 rounded-lg border border-[#eef2f7]">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-[#0f172a] flex items-center gap-2">
                  {m.full_name || m.email}
                  {m.is_platform_owner && <span className="text-[10px] font-semibold text-[#1f6fd4] bg-[#eff4ff] px-1.5 py-0.5 rounded">OWNER</span>}
                  {!m.is_active && <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded">DEACTIVATED</span>}
                </div>
                <div className="text-[12px] text-[#94a3b8] truncate">{m.email}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {editing !== m.id && <button onClick={() => { setEditing(m.id); setEditDepts(m.department_ids); }} className="text-[12px] text-[#1f6fd4] hover:underline">Edit departments</button>}
                {!m.is_platform_owner && (
                  <button onClick={() => setActive(m.id, !m.is_active)} disabled={savingId === m.id} className="text-[12px] text-[#64748b] hover:underline">{m.is_active ? "Deactivate" : "Reactivate"}</button>
                )}
              </div>
            </div>

            {editing === m.id ? (
              <div className="mt-2.5">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {departments.map((d) => (
                    <button key={d.id} onClick={() => setEditDepts((p) => toggle(p, d.id))} className={`px-2.5 py-1 rounded-full text-[12px] border ${editDepts.includes(d.id) ? "bg-[#1f6fd4] text-white border-[#1f6fd4]" : "bg-white text-[#475569] border-[#e2e8f0]"}`}>{d.name}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => saveDepts(m.id)} disabled={savingId === m.id} className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#1f6fd4] text-white rounded-lg text-[12px] font-medium disabled:opacity-50">{savingId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save</button>
                  <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-[#64748b]"><X size={12} /> Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.department_ids.length ? m.department_ids.map((id) => (
                  <span key={id} className="px-2 py-0.5 rounded-full text-[11px] bg-[#f1f5f9] text-[#475569]">{nameOf(id)}</span>
                )) : <span className="text-[12px] text-[#94a3b8]">No departments assigned</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
