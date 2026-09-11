import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { sendEmail, sesConfigured } from "@/lib/email";
import crypto from "node:crypto";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Any member can invite. Platform owner may target another org via org_id.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner, full_name").eq("id", user.id).single();
    if (!me?.org_id) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const { email, department_ids, org_id } = await request.json();
    if (!email || !/.+@.+\..+/.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    const targetOrg = (me.is_platform_owner && org_id) ? org_id : me.org_id;
    const deptIds: string[] = Array.isArray(department_ids) ? department_ids : [];

    // Already a member?
    const { data: existing } = await db.from("users").select("id").eq("org_id", targetOrg).ilike("email", email).maybeSingle();
    if (existing) return NextResponse.json({ error: "That person is already a member of this organization." }, { status: 409 });

    const token = crypto.randomBytes(24).toString("base64url");
    const { error: invErr } = await db.from("invitations").insert({
      org_id: targetOrg,
      email,
      invited_by: user.id,
      token,
      department_ids: deptIds,
      status: "pending",
    });
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

    const origin = new URL(request.url).origin;
    const link = `${origin}/accept-invite?token=${token}`;
    const { data: org } = await db.from("organizations").select("name").eq("id", targetOrg).single();
    const subject = `You're invited to ChargeGuard${org?.name ? ` — ${org.name}` : ""}`;
    const text = `${me.full_name || "A teammate"} invited you to ChargeGuard.\n\nAccept your invite and set your password:\n${link}\n\nThis link expires in 14 days.`;

    let emailed = false;
    try { emailed = (await sendEmail([email], subject, text)).ok; } catch { emailed = false; }

    // If SES isn't configured, still return the link so it can be shared manually.
    return NextResponse.json({ ok: true, emailed, link: sesConfigured() && emailed ? undefined : link });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// Revoke a pending invitation.
export async function DELETE(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing invitation id" }, { status: 400 });
    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner").eq("id", user.id).single();
    let q = db.from("invitations").update({ status: "revoked" }).eq("id", id);
    if (!me?.is_platform_owner) q = q.eq("org_id", me?.org_id);
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
