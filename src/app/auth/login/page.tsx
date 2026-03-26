"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-[#1a1a18] flex items-center justify-center">
            <Shield size={18} className="text-emerald-400" />
          </div>
          <span className="text-xl font-bold text-[#1a1a18] tracking-tight">ChargeGuard</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#e5e5e0] p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-[#1a1a18] mb-1">Sign in</h1>
          <p className="text-sm text-[#7a7a75] mb-6">Enter your credentials to continue</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10 focus:border-[#1a1a18]/20"
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#3d3d3a] block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e5e5e0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10 focus:border-[#1a1a18]/20"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#1a1a18] text-white rounded-xl text-sm font-medium hover:bg-[#2d2d2a] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Sign In
            </button>
          </form>

          <p className="text-sm text-[#7a7a75] text-center mt-4">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="text-[#1a1a18] font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
