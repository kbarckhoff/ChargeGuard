"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // 1. Sign up the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (!authData.user) {
      setError("Signup failed — no user returned");
      setLoading(false);
      return;
    }

    // 2. Create org + user record (using service role via API route)
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: authData.user.id,
        email,
        full_name: fullName,
        org_name: orgName || `${fullName}'s Organization`,
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(`${body.error}${body.detail ? ': ' + body.detail : ''}`);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // If email confirmation is disabled, redirect
    if (authData.session) {
      router.push("/dashboard");
      router.refresh();
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#1e3a8a] flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#2563eb] flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold text-white">ChargeGuard</span>
          </div>
          <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6">
            <h1 className="text-lg font-semibold text-[#0f172a] mb-2">Check your email</h1>
            <p className="text-sm text-[#64748b]">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.
            </p>
            <Link href="/auth/login" className="inline-block mt-4 text-sm text-[#2563eb] font-medium hover:underline">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1e3a8a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-xl bg-[#0f172a] flex items-center justify-center">
            <Shield size={18} className="text-emerald-400" />
          </div>
          <span className="text-xl font-bold text-white">ChargeGuard</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Create your account</h1>
          <p className="text-sm text-[#64748b] mb-6">Start your CDM audit platform</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">Full Name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40 focus:border-[#2563eb]/40"
                placeholder="Kaylee Anderson" required />
            </div>
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">Organization Name</label>
              <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40 focus:border-[#2563eb]/40"
                placeholder="Amelior Management Solutions" />
            </div>
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40 focus:border-[#2563eb]/40"
                placeholder="you@company.com" required />
            </div>
            <div>
              <label className="text-sm font-medium text-[#334155] block mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40 focus:border-[#2563eb]/40"
                placeholder="Min 8 characters" required minLength={8} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-[#2563eb] text-white rounded-xl text-sm font-semibold hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
              {loading && <Loader2 size={16} className="animate-spin" />}
              Create Account
            </button>
          </form>

          <p className="text-sm text-[#64748b] text-center mt-4">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-[#2563eb] font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
