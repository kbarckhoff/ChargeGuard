import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { genCode, hashCode } from "@/lib/otp";
import { sendEmail, sesConfigured } from "@/lib/email";
import { OTP_COOKIE, signOtpValue } from "@/lib/otp-cookie";

export const runtime = "nodejs";

const OTP_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// Emails a fresh 6-digit sign-in code to the logged-in (password-verified) user.
// If email (SES) isn't configured yet, the OTP step is skipped: we issue the
// verified cookie immediately so no one is locked out. OTP turns on automatically
// once SES env vars are set.
export async function POST() {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Deploy-safe fallback: no email provider -> skip the second factor.
    if (!sesConfigured()) {
      const exp = Date.now() + OTP_SESSION_TTL_MS;
      const value = await signOtpValue(user.id, exp, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      (await cookies()).set(OTP_COOKIE, value, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(OTP_SESSION_TTL_MS / 1000),
      });
      return NextResponse.json({ ok: true, skipped: true });
    }

    const db = admin();
    const code = genCode();
    const { error } = await db.from("login_otps").insert({
      user_id: user.id,
      code_hash: hashCode(code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    (await cookies()).delete(OTP_COOKIE);

    const subject = "Your ChargeGuard sign-in code";
    const text =
      `Your ChargeGuard verification code is ${code}\n\n` +
      `Enter it to finish signing in. The code expires in 10 minutes.\n\n` +
      `If you didn't try to sign in, you can ignore this email.`;

    let emailed = false;
    try { emailed = (await sendEmail([user.email], subject, text)).ok; } catch { emailed = false; }

    return NextResponse.json({ ok: true, emailed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
