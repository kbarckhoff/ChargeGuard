"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [resetSent, setResetSent] = useState(false);
  const [showPw, setShowPw] = useState(false);
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
      // Password verified. Middleware sends us to the OTP step if email is
      // configured, or straight to the app if it isn't yet.
      router.push("/runs");
      router.refresh();
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const redirectTo = `${window.location.origin}/auth/callback?next=/auth/update-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    // Always show success (don't reveal whether an account exists).
    if (error && !/rate|limit/i.test(error.message)) setError(error.message);
    else setResetSent(true);
  };

  return (
    <div className="min-h-screen bg-[#0a6cff] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo-login.png" alt="ChargeGuard" className="w-12 h-12 object-contain" />
          <span className="text-xl font-bold text-white tracking-tight">ChargeGuard</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 shadow-xl">
          {mode === "signin" ? (
            <>
              <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Sign in</h1>
              <p className="text-sm text-[#64748b] mb-6">Enter your credentials to continue</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#334155] block mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/40 focus:border-[#1e293b]/40"
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-[#334155]">Password</label>
                    <button type="button" onClick={() => { setMode("forgot"); setError(""); }} className="text-xs font-medium text-[#1e293b] hover:underline">
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/40 focus:border-[#1e293b]/40"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#94a3b8] hover:text-[#475569]"
                    >
                      {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-[#1e293b] text-white rounded-xl text-sm font-semibold hover:bg-[#0f172a] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Sign In
                </button>
              </form>

              <p className="text-sm text-[#64748b] text-center mt-4">
                Access is by invitation. Ask your administrator to add you.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Reset password</h1>
              <p className="text-sm text-[#64748b] mb-6">Enter your email and we&apos;ll send you a link to set a new password.</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}

              {resetSent ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
                  If an account exists for <span className="font-medium">{email}</span>, a password-reset link is on its way. Check your inbox (and spam folder), then follow the link to set a new password.
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-[#334155] block mb-1.5">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/40 focus:border-[#1e293b]/40"
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-[#1e293b] text-white rounded-xl text-sm font-semibold hover:bg-[#0f172a] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Send reset link
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => { setMode("signin"); setError(""); setResetSent(false); }}
                className="w-full text-sm text-[#1e293b] hover:underline text-center mt-4"
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
