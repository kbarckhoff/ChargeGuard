"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutDashboard, Database, Settings, LogOut, BarChart3, ClipboardList, Building2, ChevronDown, Check, Loader2, Inbox, Network } from "lucide-react";

type Org = { id: string; name: string };
type OrgInfo = { orgs: Org[]; activeOrgId: string | null; isPlatformOwner: boolean; isSuper: boolean; canAssign: boolean };

// Cache the org/role payload so the sidebar renders the right nav instantly on
// every client-side navigation instead of refetching and flickering. Backed by
// a module variable (survives route changes) and sessionStorage (survives reload).
const CACHE_KEY = "cg_orginfo";
let orgCache: OrgInfo | null = null;
function readCache(): OrgInfo | null {
  if (orgCache) return orgCache;
  try { const s = sessionStorage.getItem(CACHE_KEY); if (s) { orgCache = JSON.parse(s); return orgCache; } } catch { /* ignore */ }
  return null;
}
function writeCache(v: OrgInfo) {
  orgCache = v;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
function useOrgInfo(): OrgInfo | null {
  const [info, setInfo] = useState<OrgInfo | null>(() => (typeof window !== "undefined" ? readCache() : null));
  useEffect(() => {
    let alive = true;
    fetch("/api/orgs").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !alive) return;
      const next: OrgInfo = {
        orgs: d.orgs || [], activeOrgId: d.activeOrgId || null,
        isPlatformOwner: !!d.isPlatformOwner, isSuper: !!d.isSuper, canAssign: !!d.canAssign,
      };
      writeCache(next); setInfo(next);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return info;
}

function ClientSwitcher({ info }: { info: OrgInfo | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(info?.activeOrgId ?? null);
  useEffect(() => { if (info?.activeOrgId) setActiveId(info.activeOrgId); }, [info?.activeOrgId]);

  const orgs = info?.orgs || [];
  if (orgs.length < 2) return null;
  const activeName = orgs.find((o) => o.id === activeId)?.name || "Select client";

  const pick = async (id: string) => {
    if (id === activeId) { setOpen(false); return; }
    setBusy(true);
    await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: id }) });
    setActiveId(id);
    if (orgCache) writeCache({ ...orgCache, activeOrgId: id });
    setBusy(false); setOpen(false);
    router.refresh();
  };

  return (
    <div className="px-3 pt-2 pb-1 relative">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg bg-white border border-[#e5e7eb] hover:bg-[#f1f5f9] px-3 py-2 text-left text-[12.5px] text-[#111827]">
        <Building2 size={14} className="shrink-0 text-[#64748b]" />
        <span className="flex-1 truncate">{busy ? "Switching…" : activeName}</span>
        {busy ? <Loader2 size={13} className="animate-spin text-[#64748b]" /> : <ChevronDown size={13} className="text-[#94a3b8]" />}
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

// Global menu, grouped into labelled sections. The audit log holds the CDM
// change history (accepted changes, manual entries) across runs.
type NavItem = { label: string; href: string; icon: typeof LayoutDashboard; match?: (p: string) => boolean };
type NavSection = { title: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Dashboard", href: "/runs", icon: LayoutDashboard, match: (p) => p === "/runs" || p === "/" },
      { label: "Findings & Analysis", href: "/findings", icon: BarChart3 },
      { label: "Departments", href: "/departments", icon: Network },
    ],
  },
  {
    title: "My Work",
    items: [
      { label: "My Work Queue", href: "/queue", icon: Inbox },
      { label: "Audit Log", href: "/change-log", icon: ClipboardList },
    ],
  },
  {
    title: "Data",
    items: [{ label: "References", href: "/references", icon: Database }],
  },
  {
    title: "Account",
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
];

// Brand blue (from the Converge ribbon mark) used for the active state.
const ACTIVE = "bg-[#eaf2ff] text-[#0f172a] font-semibold";
const IDLE = "text-[#475569] hover:bg-[#eef1f5] hover:text-[#0f172a] font-medium";

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className={`relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-lg text-[13.5px] transition-colors ${active ? ACTIVE : IDLE}`}>
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-[#197ff9]" />}
      <Icon size={17} className={active ? "text-[#197ff9]" : "text-[#64748b]"} /> {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const info = useOrgInfo();
  const isOwner = !!info?.isPlatformOwner;

  const logout = async () => {
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    orgCache = null;
    await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  // Append Admin into the Account section for platform owners.
  const sections = SECTIONS.map((s) =>
    s.title === "Account" && isOwner
      ? { ...s, items: [...s.items, { label: "Admin", href: "/admin", icon: Building2, match: (p: string) => p.startsWith("/admin") } as NavItem] }
      : s
  );

  return (
    <aside className="w-[232px] shrink-0 bg-[#f7f8fa] text-[#0f172a] border-r border-[#e5e7eb] flex flex-col min-h-screen">
      <div className="flex items-center justify-center px-5 h-16">
        <img src="/logo-signin.png" alt="Converge" className="w-[44px] h-[44px] object-contain" />
      </div>
      <ClientSwitcher info={info} />
      <nav className="flex-1 px-3 pt-2 flex flex-col gap-4 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            <div className="px-4 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#94a3b8]">{section.title}</div>
            {section.items.map((item) => {
              const active = item.match ? item.match(pathname) : pathname === item.href;
              return <NavRow key={item.href} item={item} active={active} />;
            })}
          </div>
        ))}
      </nav>
      <button onClick={logout} className="flex items-center gap-2.5 px-5 py-4 text-[13px] text-[#475569] hover:text-[#0f172a] border-t border-[#e5e7eb]">
        <LogOut size={16} /> Sign out
      </button>
    </aside>
  );
}
