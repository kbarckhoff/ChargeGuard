import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { seedOrgDepartments } from "@/lib/departments";
import { sendEmail, sesConfigured } from "@/lib/email";
import { genTempPassword } from "@/lib/otp";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local.split(/[._-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || email;
}

// Platform-owner action: create a new hospital (org), seed its departments,
// provision one assigned admin for it (temp password, forced change on first
// login), email them sign-in instructions, and switch the active client to it.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { data: me } = await db.from("users").select("is_platform_owner").eq("id", user.id).single();
    if (!me?.is_platform_owner) return NextResponse.json({ error: "Only the platform owner can add hospitals" }, { status: 403 });

    const { hospital_name, admin_email, admin_name } = await request.json();
    const name = String(hospital_name || "").trim();
    const email = String(admin_email || "").trim().toLowerCase();
    if (!name) return NextResponse.json({ error: "A hospital name is required" }, { status: 400 });
    if (!email || !/.+@.+\..+/.test(email)) return NextResponse.json({ error: "A valid admin email is required" }, { status: 400 });

    // 1) Create the org.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .insert({ name, slug, contact_email: email })
      .select("id, name")
      .single();
    if (orgErr || !org) return NextResponse.json({ error: orgErr?.message || "Could not create hospital" }, { status: 500 });

    // 2) Seed departments + rev-code routing.
    try { await seedOrgDepartments(db, org.id); } catch { /* re-seedable from Settings */ }

    // 3) Provision the assigned admin.
    const fullName = String(admin_name || "").trim() || nameFromEmail(email);
    const tempPassword = genTempPassword();
    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true },
    });
    if (cErr || !created?.user) {
      // Roll back the org so we don't leave an empty hospital behind.
      try { await db.from("organizations").delete().eq("id", org.id); } catch { /* ignore */ }
      const msg = cErr?.message || "Could not create the admin account";
      const already = /already|registered|exists/i.test(msg);
      return NextResponse.json({ error: already ? "An account with that email already exists. Use a different email or add them from the client's Team page." : msg }, { status: already ? 409 : 500 });
    }
    const uid = created.user.id;

    const { error: uErr } = await db.from("users").insert({
      id: uid, org_id: org.id, email, full_name: fullName, role: "admin", is_active: true,
    });
    if (uErr) {
      await db.auth.admin.deleteUser(uid).catch(() => {});
      await db.from("organizations").delete().eq("id", org.id);
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Assign the admin to every department so they see all of their hospital's findings.
    const { data: depts } = await db.from("departments").select("id").eq("org_id", org.id);
    if (depts?.length) {
      await db.from("user_departments").insert(depts.map((d: any) => ({ user_id: uid, department_id: d.id, org_id: org.id })));
    }

    // 4) Email sign-in instructions.
    const origin = new URL(request.url).origin;
    const loginUrl = `${origin}/auth/login`;
    const subject = `You've been set up on ChargeGuard — ${org.name}`;
    const text =
      `You've been added as an administrator for ${org.name} on ChargeGuard.\n\n` +
      `Sign in here: ${loginUrl}\n` +
      `Email: ${email}\n` +
      `Temporary password: ${tempPassword}\n\n` +
      `On your first sign-in you'll set your own password${sesConfigured() ? " and enter a one-time code we email you" : ""}.`;
    let emailed = false;
    try { emailed = (await sendEmail([email], subject, text)).ok; } catch { emailed = false; }

    // 5) Switch the active client to the new hospital.
    (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
    });

    return NextResponse.json({
      ok: true, org, admin_email: email,
      emailed,
      tempPassword: (sesConfigured() && emailed) ? undefined : tempPassword,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
