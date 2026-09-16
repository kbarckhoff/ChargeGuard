import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { hashCode } from "@/lib/otp";
import { OTP_COOKIE, signOtpValue } from "@/lib/otp-cookie";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const OTP_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Verifies the emailed code. On success, sets the signed OTP cookie the
// middleware checks, and reports whether the user must change their password.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { code } = await request.json();
    if (!code) return NextResponse.json({ error: "Enter the code from your email." }, { status: 400 });

    const db = admin();
    const { data: rows } = await db
      .from("login_otps")
      .select("*")
      .eq("user_id", user.id)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(1);

    const row = rows?.[0];
    if (!row) return NextResponse.json({ error: "No active code. Request a new one." }, { status: 400 });
    if (new Date(row.expires_at).getTime() < Date.now())
      return NextResponse.json({ error: "That code expired. Request a new one." }, { status: 400 });
    if (row.attempts >= 5)
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });

    if (row.code_hash !== hashCode(String(code))) {
      await db.from("login_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
    }

    await db.from("login_otps").update({ consumed: true }).eq("id", row.id);

    const exp = Date.now() + OTP_SESSION_TTL_MS;
    const value = await signOtpValue(user.id, exp, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    (await cookies()).set(OTP_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(OTP_SESSION_TTL_MS / 1000),
    });

    const mustChange = (user.user_metadata as any)?.must_change_password === true;
    return NextResponse.json({ ok: true, mustChange });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
