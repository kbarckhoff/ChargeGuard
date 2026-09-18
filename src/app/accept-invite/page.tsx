"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "form" | "done">("loading");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    if (!t) { setState("invalid"); setReason("No invite token in the link."); return; }
    fetch(`/api/team/accept?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) { setEmail(d.email); setOrgName(d.org_name); setState("form"); }
        else { setState("invalid"); setReason(d.reason === "expired" ? "This invite has expired." : d.reason === "used" ? "This invite has already been used." : "This invite link is not valid."); }
      })
      .catch(() => { setState("invalid"); setReason("Could not check this invite."); });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, password }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Could not accept the invite"); setSubmitting(false); return; }
      setState("done");
      setTimeout(() => router.push("/auth/login"), 1800);
    } catch (err: any) { setError(err?.message || "Something went wrong"); setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f1f5f9] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#e2e8f0] shadow-sm p-7">
        <div className="flex items-center gap-2 mb-5">
          <img src="/logo-mark.png" alt="ChargeGuard" className="w-7 h-7 object-contain" />
          <span className="font-bold text-[15px] text-[#0f172a]">ChargeGuard</span>
        </div>

        {state === "loading" && <p className="text-sm text-[#64748b]">Checking your invite…</p>}

        {state === "invalid" && (
          <div>
            <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Invite unavailable</h1>
            <p className="text-sm text-[#64748b]">{reason} Ask whoever invited you to send a new link.</p>
          </div>
        )}

        {state === "done" && (
          <div>
            <h1 className="text-lg font-semibold text-[#0f172a] mb-1">You're all set</h1>
            <p className="text-sm text-[#64748b]">Your account is ready. Taking you to sign in…</p>
          </div>
        )}

        {state === "form" && (
          <form onSubmit={submit}>
            <h1 className="text-lg font-semibold text-[#0f172a] mb-1">Accept your invite</h1>
            <p className="text-sm text-[#64748b] mb-5">Join {orgName || "your team"} on ChargeGuard as <span className="font-medium text-[#334155]">{email}</span>.</p>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
            <label className="text-sm font-medium text-[#334155] block mb-1.5">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full mb-4 px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" placeholder="Jane Smith" />
            <label className="text-sm font-medium text-[#334155] block mb-1.5">Set a password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full mb-1 px-3 py-2.5 text-sm border border-[#e2e8f0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20" placeholder="At least 8 characters" />
            <p className="text-[11px] text-[#94a3b8] mb-5">Minimum 8 characters.</p>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-[#1e293b] text-white rounded-xl text-sm font-medium hover:bg-[#0f172a] disabled:opacity-50">
              {submitting ? "Creating your account…" : "Accept invite"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
