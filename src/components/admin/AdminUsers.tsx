"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, Copy, Check, X } from "lucide-react";
import { APP_ROLE_LABEL, type AppRole } from "@/lib/roles";

type U = { id: string; full_name: string; email: string; app_role: AppRole; department: string | null; is_active: boolean; is_platform_owner: boolean };

const ROLES: AppRole[] = ["super_user", "analyst", "member"];

export function AdminUsers({ users }: { users: U[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [f, setF] = useState({ email: "", full_name: "", app_role: "member" as AppRole, department: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ link?: string; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ app_role: AppRole; department: string }>({ app_role: "member", department: "" });
  const [savingId, setSavingId] = useState<string | null>(null);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const add = async () => {
    setBusy(true); setErr(""); setMsg(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.email, full_name: f.full_name, app_role: f.app_role, department: f.department }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Could not add user"); setBusy(false); return; }
      setMsg(d.added
        ? { text: `${f.email} already had an account and now has access to this client.` }
        : d.tempPassword
          ? { link: d.tempPassword, text: "User created, but email couldn't be sent. Share this temporary password securely:" }
          : { text: `Added ${f.email}. They'll get a temporary password by email.` });
      setF({ email: "", full_name: "", app_role: "member", department: "" });
      setBusy(false); router.refresh();
    } catch (e: any) { setErr(e?.message || "Something went wrong"); setBusy(false); }
  };

  const saveEdit = async (id: string) => {
    setSavingId(id);
    await fetch("/api/team/update", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: id, app_role: edit.app_role, department: edit.department }),
    });
    setSavingId(null); setEditId(null); router.refresh();
  };

  const setActive = async (id: string, is_active: boolean) => {
    setSavingId(id);
    await fetch("/api/team/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: id, is_active }) });
    setSavingId(null); router.refresh();
  };

  const inp = "w-full h-9 border border-[#e2e8f0] rounded-lg px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setAddOpen((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a]">
          <UserPlus size={14} /> Add user
        </button>
      </div>

      {addOpen && (
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          {err && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}
          {msg && (
            <div className="mb-3 p-2.5 bg-[#e7f7ef] border border-[#bbe9d1] rounded-lg text-[13px] text-[#067647]">
              {msg.text}
              {msg.link && <span className="ml-2 inline-flex items-center gap-2"><code className="px-1.5 py-0.5 rounded bg-white border border-[#bbe9d1] text-[#0f172a] font-mono">{msg.link}</code><button onClick={() => navigator.clipboard?.writeText(msg.link!)} className="inline-flex items-center gap-1 text-[#0f172a] underline"><Copy size={11} /> copy</button></span>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[12px] font-medium text-[#475569] mb-1">Email</label><input className={inp} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@hospital.org" /></div>
            <div><label className="block text-[12px] font-medium text-[#475569] mb-1">Full name</label><input className={inp} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Jane Doe" /></div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Role</label>
              <select className={inp} value={f.app_role} onChange={(e) => set("app_role", e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{APP_ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div><label className="block text-[12px] font-medium text-[#475569] mb-1">Department</label><input className={inp} value={f.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Pharmacy, Lab, Supply Chain" /></div>
          </div>
          <div className="flex justify-end mt-3">
            <button disabled={busy || !f.email} onClick={add} className="px-4 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a] disabled:opacity-50 inline-flex items-center gap-1.5">{busy && <Loader2 size={13} className="animate-spin" />} Add user</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#e2e8f0]">
              <th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Department</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const editing = editId === u.id;
              return (
                <tr key={u.id} className="border-b border-[#f1f5f9]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[#0f172a]">{u.full_name || u.email}</div>
                    <div className="text-[12px] text-[#94a3b8]">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {editing ? (
                      <select className={inp + " w-40"} value={edit.app_role} onChange={(e) => setEdit((p) => ({ ...p, app_role: e.target.value as AppRole }))}>
                        {ROLES.map((r) => <option key={r} value={r}>{APP_ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      <span className="text-[#334155]">{APP_ROLE_LABEL[u.app_role] || "User"}{u.is_platform_owner && " · owner"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {editing ? <input className={inp + " w-40"} value={edit.department} onChange={(e) => setEdit((p) => ({ ...p, department: e.target.value }))} placeholder="Department" />
                      : <span className="text-[#64748b]">{u.department || "—"}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.is_active ? <span className="text-[10px] font-semibold text-[#067647] bg-[#e7f7ef] px-1.5 py-0.5 rounded">Active</span>
                      : <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded">Deactivated</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right">
                    {editing ? (
                      <span className="inline-flex items-center gap-2">
                        <button onClick={() => saveEdit(u.id)} disabled={savingId === u.id} className="text-[#1e293b]">{savingId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}</button>
                        <button onClick={() => setEditId(null)} className="text-[#94a3b8]"><X size={15} /></button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button onClick={() => { setEditId(u.id); setEdit({ app_role: u.app_role || "member", department: u.department || "" }); }} className="text-[12px] text-[#1e293b] hover:underline">Edit</button>
                        {!u.is_platform_owner && <button onClick={() => setActive(u.id, !u.is_active)} disabled={savingId === u.id} className="text-[12px] text-[#64748b] hover:underline">{u.is_active ? "Deactivate" : "Reactivate"}</button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[#94a3b8]">No users yet. Add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
