import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { sendEmail, sesConfigured, renderEmail } from "@/lib/email";
import { genTempPassword } from "@/lib/otp";
import { resolveActiveOrg } from "@/lib/active-org";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// Turn an email into a reasonable display name from the local part.
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || email;
}

// Invite = admin creates the account directly. The user gets a temporary
// password by email, is email-confirmed immediately, and is forced to change
// the password on first sign-in (must_change_password). Every sign-in also
// requires the emailed OTP. Any member may invite; a platform owner may target
// another org via org_id.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner, full_name").eq("id", user.id).single();
    if (!me?.org_id) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const { email, org_id } = await request.json();
    if (!email || !/.+@.+\..+/.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    // Add to the client the inviter is currently working in (platform owners may
    // target another org explicitly).
    const { orgId: activeOrg } = await resolveActiveOrg(db, user.id);
    const targetOrg = (me.is_platform_owner && org_id) ? org_id : (activeOrg || me.org_id);
    const cleanEmail = String(email).trim().toLowerCase();

    const origin = new URL(request.url).origin;
    const loginUrl = `${origin}/auth/login`;
    const { data: org } = await db.from("organizations").select("name").eq("id", targetOrg).single();
    const orgLabel = org?.name ? ` — ${org.name}` : "";

    // If this email already has an account, don't error — just grant access to
    // this client (org_members) and email them that they've been added.
    const { data: existingUser } = await db.from("users").select("id, org_id").ilike("email", cleanEmail).maybeSingle();
    if (existingUser) {
      const alreadyHome = existingUser.org_id === targetOrg;
      const { data: existingMember } = await db.from("org_members").select("org_id").eq("user_id", existingUser.id).eq("org_id", targetOrg).maybeSingle();
      if (alreadyHome || existingMember) {
        return NextResponse.json({ error: "That person already has access to this client." }, { status: 409 });
      }
      await db.from("org_members").upsert({ user_id: existingUser.id, org_id: targetOrg }, { onConflict: "user_id,org_id" });

      const subject = `You've been added to ChargeGuard${orgLabel}`;
      const text =
        `${me.full_name || "A teammate"} added you to ${org?.name || "a client"} on ChargeGuard.\n\n` +
        `You can now access it with your existing account. Sign in here: ${loginUrl}\n\n` +
        `Use the client switcher at the top of the left menu to move between the clients you have access to.`;
      const html = renderEmail({
        origin,
        title: "You've been added to a client",
        paragraphs: [
          `${me.full_name || "A teammate"} added you to ${org?.name || "a client"} on ChargeGuard.`,
          "You can now access it with your existing account. Use the client switcher at the top of the left menu to move between the clients you have access to.",
        ],
        button: { text: "Sign in to ChargeGuard", url: loginUrl },
      });
      let emailed = false;
      try { emailed = (await sendEmail([cleanEmail], subject, text, html)).ok; } catch { emailed = false; }
      return NextResponse.json({ ok: true, added: true, emailed });
    }

    const fullName = nameFromEmail(cleanEmail);
    const tempPassword = genTempPassword();

    // Create the auth user with the temp password (email pre-confirmed).
    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true },
    });
    if (cErr || !created?.user) {
      const msg = cErr?.message || "Could not create the account";
      const already = /already|registered|exists/i.test(msg);
      return NextResponse.json({ error: already ? "An account with that email already exists." : msg }, { status: already ? 409 : 500 });
    }
    const uid = created.user.id;

    // Create their profile row in the target org.
    const { error: uErr } = await db.from("users").insert({
      id: uid, org_id: targetOrg, email: cleanEmail, full_name: fullName, role: "auditor", is_active: true,
    });
    if (uErr) {
      await db.auth.admin.deleteUser(uid).catch(() => {});
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Record the client membership (their home org).
    await db.from("org_members").upsert({ user_id: uid, org_id: targetOrg }, { onConflict: "user_id,org_id" });

    // Email the temporary password + where to sign in.
    const subject = `Your ChargeGuard account${orgLabel}`;
    const text =
      `${me.full_name || "A teammate"} added you to ChargeGuard.\n\n` +
      `Sign in here: ${loginUrl}\n` +
      `Email: ${cleanEmail}\n` +
      `Temporary password: ${tempPassword}\n\n` +
      `On your first sign-in you'll set a new password and enter a one-time code we email you.`;
    const html = renderEmail({
      origin,
      title: "Your ChargeGuard account is ready",
      paragraphs: [
        `${me.full_name || "A teammate"} set up a ChargeGuard account for you${org?.name ? ` at ${org.name}` : ""}.`,
        `Sign in with your email (${cleanEmail}) and the temporary password below.`,
      ],
      code: tempPassword,
      button: { text: "Sign in to ChargeGuard", url: loginUrl },
      footnote: "On your first sign-in you'll set a new password and enter a one-time code we email you.",
    });

    let emailed = false;
    try { emailed = (await sendEmail([cleanEmail], subject, text, html)).ok; } catch { emailed = false; }

    // If email isn't configured/failed, hand the temp password back so the admin
    // can share it securely. Never return it when the email went out.
    return NextResponse.json({
      ok: true,
      emailed,
      tempPassword: (sesConfigured() && emailed) ? undefined : tempPassword,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// Deactivate a member (there are no pending token invites in this model).
export async function DELETE(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner").eq("id", user.id).single();
    let q = db.from("users").update({ is_active: false }).eq("id", id);
    if (!me?.is_platform_owner) q = q.eq("org_id", me?.org_id);
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
