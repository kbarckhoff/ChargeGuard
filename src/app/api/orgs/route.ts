import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE, resolveActiveOrg, listMemberOrgs } from "@/lib/active-org";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// GET: who am I + which client is active + (platform owners) the list of clients.
export async function GET() {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { orgId, ownOrg, isPlatformOwner } = await resolveActiveOrg(db, user.id);

    let orgs: { id: string; name: string }[] = [];
    if (isPlatformOwner) {
      const { data } = await db.from("organizations").select("id, name").order("name");
      orgs = data || [];
    } else {
      // Regular users see the clients they belong to (home org + org_members).
      orgs = await listMemberOrgs(db, user.id, ownOrg);
    }
    return NextResponse.json({ isPlatformOwner, activeOrgId: orgId, ownOrg, orgs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST: platform owner sets the active client (cookie). {org_id}
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { data: me } = await db.from("users").select("is_platform_owner, org_id").eq("id", user.id).single();

    const { org_id } = await request.json();
    if (!org_id) return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
    const { data: o } = await db.from("organizations").select("id").eq("id", org_id).maybeSingle();
    if (!o?.id) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

    // Platform owners may switch to any client; everyone else only to a client
    // they belong to (their home org or an org_members grant).
    if (!me?.is_platform_owner) {
      const isHome = me?.org_id === org_id;
      let isMember = isHome;
      if (!isMember) {
        const { data: m } = await db.from("org_members").select("org_id").eq("user_id", user.id).eq("org_id", org_id).maybeSingle();
        isMember = !!m?.org_id;
      }
      if (!isMember) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    (await cookies()).set(ACTIVE_ORG_COOKIE, org_id, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
