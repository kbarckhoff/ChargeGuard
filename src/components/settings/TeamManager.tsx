"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, Copy } from "lucide-react";

type Member = { id: string; full_name: string; email: string; is_active: boolean; is_platform_owner: boolean; via?: string };

export function TeamManager({ members }: { members: Member[] }) {
  const router = useRouter();

  // Invite form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ link?: string; text: string } | null>(null);
  const [inviteErr, setInviteErr] = useState("");

  const [savingId, setSavingId] = useState<string | null>(null);

  const sendInvite = async () => {
    setSending(true); setInviteErr(""); setInviteMsg(null);
    try {
      const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await res.json();
      if (!res.ok) { setInviteErr(d.error || "Could not send invite"); setSending(false); return; }
      setInviteMsg(
        d.added
          ? { text: `${email} already had an account — they've been given access to this client and emailed a heads-up.` }
          : d.tempPassword
            ? { link: d.tempPassword, text: "Account created, but email couldn't be sent. Share this temporary password securely:" }
            : { text: `Invited ${email}. They'll receive a temporary password by email and set their own on first sign-in.` }
      );
      setEmail(""); setSending(false);
      router.refresh();
    } catch (e: any) { setInviteErr(e?.message || "Something went wrong"); setSending(false); }
  };

  const setActive = async (userId: string, is_active: boolean) => {
    setSavingId(userId);
    await fetch("/api/team/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, is_active }) });
    setSavingId(null); router.refresh();
  };

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#334155]">Team</h3>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">Everyone here can see this client&apos;s findings. Invite by email; if they already have an account they&apos;re given access to this client.</p>
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
                <span className="ml-2 inline-flex items-center gap-2">
                  <code className="px-1.5 py-0.5 rounded bg-white border border-[#bbe9d1] text-[#0f172a] font-mono">{inviteMsg.link}</code>
                  <button onClick={() => navigator.clipboard?.writeText(inviteMsg.link!)} className="inline-flex items-center gap-1 text-[#0f172a] underline"><Copy size={11} /> copy</button>
                </span>
              )}
            </div>
          )}
          <label className="text-[13px] font-medium text-[#334155] block mb-1.5">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hospital.org" className="w-full mb-3 px-3 py-2 text-[13px] border border-[#e2e8f0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1f6fd4]/20" />
          <button disabled={sending || !email} onClick={sendInvite} className="px-4 py-2 bg-[#1f6fd4] text-white rounded-lg text-[13px] font-medium hover:bg-[#1a5fb8] disabled:opacity-50 inline-flex items-center gap-1.5">
            {sending && <Loader2 size={13} className="animate-spin" />} Send invite
          </button>
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
                  {m.via === "shared" && <span className="text-[10px] font-semibold text-[#3730a3] bg-[#eef2ff] px-1.5 py-0.5 rounded">SHARED ACCESS</span>}
                  {!m.is_active && <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded">DEACTIVATED</span>}
                </div>
                <div className="text-[12px] text-[#94a3b8] truncate">{m.email}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!m.is_platform_owner && m.via !== "shared" && (
                  <button onClick={() => setActive(m.id, !m.is_active)} disabled={savingId === m.id} className="text-[12px] text-[#64748b] hover:underline">{m.is_active ? "Deactivate" : "Reactivate"}</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
