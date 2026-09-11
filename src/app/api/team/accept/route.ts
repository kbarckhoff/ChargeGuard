import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Accept an invitation: the invited person sets their own name + password. We
// create their auth user, their profile in the invite's org, and their
// department memberships, then mark the invite accepted.
export async function POST(request: Request) {
  try {
    const { token, full_name, password } = await request.json();
    if (!token || !full_name || !password) return NextResponse.json({ error: "Name, password, and a valid invite are required" }, { status: 400 });
    if (String(password).length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const db = admin();
    const { data: inv } = await db.from("invitations").select("*").eq("token", token).maybeSingle();
    if (!inv) return NextResponse.json({ error: "This invite link is not valid." }, { status: 404 });
    if (inv.status !== "pending") return NextResponse.json({ error: "This invite has already been used or revoked." }, { status: 409 });
    if (new Date(inv.expires_at).getTime() < Date.now()) return NextResponse.json({ error: "This invite has expired. Ask for a new one." }, { status: 410 });

    // Create the auth user (email confirmed — they came from an emailed link).
    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email: inv.email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (cErr || !created?.user) return NextResponse.json({ error: cErr?.message || "Could not create the account" }, { status: 500 });
    const uid = created.user.id;

    const { error: uErr } = await db.from("users").insert({
      id: uid, org_id: inv.org_id, email: inv.email, full_name, role: "auditor", is_active: true,
    });
    if (uErr) {
      await db.auth.admin.deleteUser(uid).catch(() => {});
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    const deptIds: string[] = Array.isArray(inv.department_ids) ? inv.department_ids : [];
    if (deptIds.length) {
      await db.from("user_departments").insert(deptIds.map((d) => ({ user_id: uid, department_id: d, org_id: inv.org_id })));
    }

    await db.from("invitations").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", inv.id);
    return NextResponse.json({ ok: true, email: inv.email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// Look up a pending invite (for the accept page to show who/where).
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const db = admin();
  const { data: inv } = await db.from("invitations").select("email, org_id, status, expires_at").eq("token", token).maybeSingle();
  if (!inv) return NextResponse.json({ valid: false, reason: "not_found" });
  if (inv.status !== "pending") return NextResponse.json({ valid: false, reason: "used" });
  if (new Date(inv.expires_at).getTime() < Date.now()) return NextResponse.json({ valid: false, reason: "expired" });
  const { data: org } = await db.from("organizations").select("name").eq("id", inv.org_id).single();
  return NextResponse.json({ valid: true, email: inv.email, org_name: org?.name || null });
}
