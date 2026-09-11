"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Shield, LogOut, Search, Bell, HelpCircle, Home } from "lucide-react";

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
        <Link href="/assessment" className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-[9px] bg-[#1e3a8a] flex items-center justify-center">
            <Shield size={16} className="text-[#2563eb]" />
          </div>
          <span className="font-bold text-[16px] tracking-tight text-[#1e3a8a]">ChargeGuard</span>
        </Link>

        <div className="flex-1 flex justify-center px-4">
          <div className="relative w-full max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9aa2af]" />
            <input
              type="text"
              placeholder="Search charge codes, findings, tasks…"
              className="w-full h-[38px] pl-10 pr-3 rounded-[10px] bg-[#f6f7f9] border border-[#e2e6ec] text-[13px] text-[#111827] placeholder-[#9aa2af] focus:outline-none focus:bg-white focus:border-[#2563eb]"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="hidden md:inline text-xs bg-[#f6f7f9] border border-[#e2e6ec] text-[#374151] font-medium px-3 py-1.5 rounded-full mr-1">Sample Hospital · Q3 2026</span>
          <Link href="/assessment" className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Home"><Home size={18} /></Link>
          <button className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Help"><HelpCircle size={18} /></button>
          <button className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Notifications"><Bell size={18} /></button>
          <button onClick={handleLogout} className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[#9aa2af] hover:bg-[#f6f7f9]" title="Sign out"><LogOut size={18} /></button>
          <div className="w-[34px] h-[34px] rounded-full bg-[#1e3a8a] flex items-center justify-center text-white text-xs font-bold ml-1">KB</div>
        </div>
      </div>
    </header>
  );
}
