"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutDashboard, Database, Settings, LogOut, BarChart3, ClipboardList, Building2, ChevronDown, Check, Loader2 } from "lucide-react";

type Org = { id: string; name: string };

// Client switcher shown to anyone with access to more than one client
// (platform owners, or users granted shared access to multiple clients).
function ClientSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/orgs").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setOrgs(d.orgs || []);
      setActiveId(d.activeOrgId || null);
    }).catch(() => {});
  }, []);

  if (orgs.length < 2) return null;
  const activeName = orgs.find((o) => o.id === activeId)?.name || "Select client";

  const pick = async (id: string) => {
    if (id === activeId) { setOpen(false); return; }
    setBusy(true);
    await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: id }) });
    setActiveId(id); setBusy(false); setOpen(false);
    router.refresh();
  };

  return (
    <div className="px-3 pt-2 pb-1 relative">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-left text-[12.5px] text-white">
        <Building2 size={14} className="shrink-0 text-white/80" />
        <span className="flex-1 truncate">{busy ? "Switching…" : activeName}</span>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} className="text-white/70" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 mt-1 z-20 bg-white rounded-lg shadow-lg border border-[#e2e8f0] py-1 max-h-72 overflow-auto">
            {orgs.map((o) => (
              <button key={o.id} onClick={() => pick(o.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-[#111827] hover:bg-[#f6f7f9] text-left">
                <span className="truncate">{o.name}</span>
                {o.id === activeId && <Check size={14} className="text-[#1e293b] shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Global menu: the hub (Dashboard), Findings & Analysis (results across reviews),
// the CDM Change Log (accepted changes across runs), the CMS reference data
// (References), and Settings.
const NAV = [
  { label: "Dashboard", href: "/runs", icon: LayoutDashboard },
  { label: "Findings & Analysis", href: "/findings", icon: BarChart3 },
  { label: "Change Log", href: "/change-log", icon: ClipboardList },
  { label: "References", href: "/references", icon: Database },
  { label: "Settings", href: "/settings", icon: Settings },
];

// Persistent left navigation for the hub pages (Panacea-style blue rail).
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    fetch("/api/orgs").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.isPlatformOwner) setIsOwner(true); }).catch(() => {});
  }, []);
  const logout = async () => {
    await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };
  return (
    <aside className="w-[224px] shrink-0 bg-[#1e293b] text-white flex flex-col min-h-screen">
      <div className="flex items-center gap-1.5 px-5 h-14">
        <img src="/logo-mark.png" alt="ChargeGuard" className="w-[30px] h-[30px] object-contain" />
        <span className="font-bold text-[15px] tracking-tight">ChargeGuard</span>
      </div>
      <ClientSwitcher />
      <nav className="flex-1 px-3 pt-3 flex flex-col gap-1">
        {NAV.map((n) => {
          const active = pathname === n.href || (n.href === "/runs" && pathname === "/");
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
              <Icon size={17} /> {n.label}
            </Link>
          );
        })}
        {isOwner && (
          <Link href="/admin" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${pathname.startsWith("/admin") ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
            <Building2 size={17} /> Admin
          </Link>
        )}
      </nav>
      <button onClick={logout} className="flex items-center gap-2.5 px-5 py-4 text-[13px] text-white/80 hover:text-white border-t border-white/15">
        <LogOut size={16} /> Sign out
      </button>
    </aside>
  );
}
