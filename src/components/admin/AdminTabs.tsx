"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Hospitals" },
  { href: "/admin/users", label: "Users & Roles" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-[#e2e8f0] mb-6">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${active ? "border-[#1e293b] text-[#1e293b]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
