"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutDashboard, Database, Settings, LogOut, BarChart3 } from "lucide-react";

// Global menu: the hub (Dashboard), Findings & Analysis (results across reviews),
// the CMS reference data (References), and Settings.
const NAV = [
  { label: "Dashboard", href: "/runs", icon: LayoutDashboard },
  { label: "Findings & Analysis", href: "/findings", icon: BarChart3 },
  { label: "References", href: "/references", icon: Database },
  { label: "Settings", href: "/settings", icon: Settings },
];

// Persistent left navigation for the hub pages (Panacea-style blue rail).
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = async () => {
    await createClient().auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };
  return (
    <aside className="w-[224px] shrink-0 bg-[#1f6fd4] text-white flex flex-col min-h-screen">
      <div className="flex items-center gap-2.5 px-5 h-14">
        <div className="w-[26px] h-[26px] rounded-[7px] bg-white flex items-center justify-center overflow-hidden"><img src="/logo-icon.png" alt="ChargeGuard" className="w-[19px] h-[19px] object-contain" /></div>
        <span className="font-bold text-[15px] tracking-tight">ChargeGuard</span>
      </div>
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
      </nav>
      <button onClick={logout} className="flex items-center gap-2.5 px-5 py-4 text-[13px] text-white/80 hover:text-white border-t border-white/15">
        <LogOut size={16} /> Sign out
      </button>
    </aside>
  );
}
