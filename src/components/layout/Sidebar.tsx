"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard, ClipboardCheck, FileSpreadsheet, FileText,
  Building2, DollarSign, PieChart, Settings, ChevronLeft,
  ChevronRight, Shield, LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/audits", label: "Audits", icon: ClipboardCheck },
  { href: "/charge-master", label: "Charge Master", icon: FileSpreadsheet },
  { href: "/claim-reviews", label: "Claim Reviews", icon: FileText },
  { href: "/departments", label: "Departments", icon: Building2 },
  { href: "/pricing", label: "Pricing", icon: DollarSign },
  { href: "/reports", label: "Reports", icon: PieChart },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <aside className={`${collapsed ? "w-16" : "w-56"} bg-[#1a1a18] text-white flex flex-col transition-all duration-200 flex-shrink-0`}>
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-4 h-14 border-b border-white/10`}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Shield size={14} className="text-white" />
            </div>
            <span className="font-semibold text-sm tracking-tight">ChargeGuard</span>
          </Link>
        )}
        <button onClick={() => setCollapsed((c) => !c)} className="p-1 hover:bg-white/10 rounded">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/8 hover:text-white/90"
              }`}
            >
              <item.icon size={17} />
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pb-3 space-y-0.5">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/8"
        >
          <Settings size={17} />
          {!collapsed && <span className="font-medium">Settings</span>}
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/8"
        >
          <LogOut size={17} />
          {!collapsed && <span className="font-medium">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
