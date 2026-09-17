"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    // Set the new password AND clear the temp-password flag in one call.
    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#0a6cff] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo-login.png" alt="ChargeGuard" className="w-12 h-12 object-contain" />
          <span className="text-xl font-bold text-white tracking-tight">ChargeGuard</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Set your password</h1>
          <p className="text-sm text-[#64748b] mb-6">Choose a new password for your account.</p>

          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">New password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40"
                placeholder="At least 8 characters" required minLength={8} />
            </div>
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">Confirm password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40"
                placeholder="Re-enter password" required minLength={8} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-[#2563eb] text-white rounded-xl text-sm font-semibold hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />} Save password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
