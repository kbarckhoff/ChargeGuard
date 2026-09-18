"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Shield, LogOut, Search, Bell, HelpCircle, Home, ChevronDown, Check, Plus, Building2, Loader2 } from "lucide-react";

type Org = { id: string; name: string };

function ClientSwitcher() {
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/orgs");
      if (!r.ok) return;
      const d = await r.json();
      setIsOwner(!!d.isPlatformOwner);
      setOrgs(d.orgs || []);
      setActiveId(d.activeOrgId || null);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const activeName = orgs.find((o) => o.id === activeId)?.name || "Select client";

  const pick = async (id: string) => {
    if (id === activeId) { setOpen(false); return; }
    setBusy(true);
    await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: id }) });
    setActiveId(id); setBusy(false); setOpen(false);
    router.refresh();
  };

  const addClient = async () => {
    const name = window.prompt("New client (hospital) name:");
    if (!name || !name.trim()) return;
    setBusy(true);
    const r = await fetch("/api/orgs/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { alert(d.error || "Could not create client"); return; }
    await load(); setOpen(false); router.refresh();
  };

  // Non-owners see a static chip of their org (no switching).
  if (!isOwner) {
    return activeName ? (
      <span className="hidden md:inline text-xs bg-[#f6f7f9] border border-[#e2e6ec] text-[#374151] font-medium px-3 py-1.5 rounded-full mr-1">{activeName}</span>
    ) : null;
  }

  return (
    <div className="relative mr-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs bg-[#f6f7f9] border border-[#e2e6ec] text-[#374151] font-medium pl-2.5 pr-2 py-1.5 rounded-full hover:border-[#1e293b]/50"
        title="Switch client"
      >
        <Building2 size={13} className="text-[#1e293b]" />
        <span className="max-w-[180px] truncate">{busy ? "Switching…" : activeName}</span>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={13} className="text-[#9aa2af]" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 bg-white border border-[#e2e6ec] rounded-xl shadow-lg py-1.5 z-50">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#9aa2af]">Clients</div>
          <div className="max-h-72 overflow-auto">
            {orgs.map((o) => (
              <button key={o.id} onClick={() => pick(o.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-[#111827] hover:bg-[#f6f7f9] text-left">
                <span className="truncate">{o.name}</span>
                {o.id === activeId && <Check size={14} className="text-[#1e293b] shrink-0" />}
              </button>
            ))}
            {orgs.length === 0 && <div className="px-3 py-2 text-[13px] text-[#9aa2af]">No clients yet</div>}
          </div>
          <div className="border-t border-[#eef2f7] mt-1 pt-1">
            <button onClick={addClient} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-[#1e293b] hover:bg-[#f6f7f9]">
              <Plus size={14} /> New client
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopNav() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <header className="bg-white border-b border-[#edf0f4] flex-shrink-0">
      <div className="h-[60px] px-6 flex items-center gap-5">
        <Link href="/runs" className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-[9px] bg-[#1e3a8a] flex items-center justify-center">
            <Shield size={16} className="text-[#1e293b]" />
          </div>
          <span className="font-bold text-[16px] tracking-tight text-[#1e3a8a]">ChargeGuard</span>
        </Link>

        <div className="flex-1 flex justify-center px-4">
          <div className="relative w-full max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa2af]" />
            <input
              type="text"
              placeholder="Search charge codes, findings, tasks…"
              className="w-full h-[38px] pl-10 pr-3 rounded-[10px] bg-[#f6f7f9] border border-[#e2e6ec] text-[13px] text-[#111827] placeholder-[#9aa2af] focus:outline-none focus:bg-white focus:border-[#1e293b]"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <ClientSwitcher />
          <Link href="/runs" className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Home"><Home size={18} /></Link>
          <button className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Help"><HelpCircle size={18} /></button>
          <button className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Notifications"><Bell size={18} /></button>
          <button onClick={handleLogout} className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Sign out"><LogOut size={18} /></button>
          <div className="w-[34px] h-[34px] rounded-full bg-[#1e3a8a] flex items-center justify-center text-white text-xs font-bold ml-1">KB</div>
        </div>
      </div>
    </header>
  );
}
