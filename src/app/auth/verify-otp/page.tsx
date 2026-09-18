"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

export default function VerifyOtpPage() {
  const router = useRouter();
  const supabase = createClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const sentRef = useRef(false);

  // Send a code once when the page loads.
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    (async () => {
      const res = await fetch("/api/auth/otp/send", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (d.skipped) { router.push("/runs"); router.refresh(); return; }
      if (!res.ok) setError(d.error || "Could not send a code.");
      else setInfo("We emailed you a 6-digit code. It expires in 10 minutes.");
    })();
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Incorrect code."); setLoading(false); return; }
    router.push(d.mustChange ? "/auth/update-password" : "/runs");
    router.refresh();
  };

  const resend = async () => {
    setResending(true); setError(""); setInfo("");
    const res = await fetch("/api/auth/otp/send", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setResending(false);
    if (!res.ok) setError(d.error || "Could not resend.");
    else setInfo("A new code is on its way.");
  };

  const signOut = async () => { await supabase.auth.signOut(); router.push("/auth/login"); router.refresh(); };

  return (
    <div className="min-h-screen bg-[#0a6cff] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo-login.png" alt="ChargeGuard" className="w-12 h-12 object-contain" />
          <span className="text-xl font-bold text-white tracking-tight">ChargeGuard</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Verify it&apos;s you</h1>
          <p className="text-sm text-[#64748b] mb-6">Enter the code we emailed you to finish signing in.</p>

          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
          {info && !error && <div className="mb-4 p-3 bg-[#eff6ff] border border-[#bfdbfe] rounded-xl text-sm text-[#1e40af]">{info}</div>}

          <form onSubmit={verify} className="space-y-4">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full px-3 py-2.5 text-center tracking-[0.5em] text-lg font-semibold border border-[#e2e8f0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/40"
              placeholder="000000"
              required
            />
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full py-2.5 bg-[#1e293b] text-white rounded-xl text-sm font-semibold hover:bg-[#0f172a] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />} Verify
            </button>
          </form>

          <div className="flex items-center justify-between mt-4 text-sm">
            <button onClick={resend} disabled={resending} className="text-[#1e293b] font-medium hover:underline disabled:opacity-50">
              {resending ? "Sending…" : "Resend code"}
            </button>
            <button onClick={signOut} className="text-[#64748b] hover:underline">Back to sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
