import { cookies } from "next/headers";

// Platform owners (the firm) can work inside any client org. The "active client"
// is stored in this cookie; every server read/write resolves the org through
// resolveActiveOrg so switching clients re-scopes the whole app. Non-owners are
// always pinned to their own org regardless of the cookie.

export const ACTIVE_ORG_COOKIE = "cg_active_org";

export interface ResolvedOrg {
  orgId: string | null;      // the org to scope data to
  ownOrg: string | null;     // the user's home org
  isPlatformOwner: boolean;
}

/**
 * Resolve the org a request should act on. Pass a service-role (admin) client.
 * A platform owner can switch to any org via the cg_active_org cookie; a regular
 * user can switch to any org they're a member of (org_members). Otherwise the
 * user's own home org is used.
 */
export async function resolveActiveOrg(admin: any, userId: string): Promise<ResolvedOrg> {
  const { data: me } = await admin
    .from("users")
    .select("org_id, is_platform_owner")
    .eq("id", userId)
    .single();

  const ownOrg = me?.org_id ?? null;
  const isPlatformOwner = !!me?.is_platform_owner;
  let orgId = ownOrg;

  const picked = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (picked && picked !== ownOrg) {
    if (isPlatformOwner) {
      const { data: o } = await admin.from("organizations").select("id").eq("id", picked).maybeSingle();
      if (o?.id) orgId = o.id;
    } else {
      // A regular user may only switch to an org they belong to.
      const { data: m } = await admin
        .from("org_members").select("org_id").eq("user_id", userId).eq("org_id", picked).maybeSingle();
      if (m?.org_id) orgId = m.org_id;
    }
  }

  return { orgId, ownOrg, isPlatformOwner };
}

/**
 * The set of orgs a user can act in: their home org plus any org_members grants.
 * Platform owners are handled separately (they see every org).
 */
export async function listMemberOrgs(admin: any, userId: string, ownOrg: string | null): Promise<{ id: string; name: string }[]> {
  const ids = new Set<string>();
  if (ownOrg) ids.add(ownOrg);
  const { data: mem } = await admin.from("org_members").select("org_id").eq("user_id", userId);
  for (const m of mem || []) if ((m as any).org_id) ids.add((m as any).org_id);
  if (ids.size === 0) return [];
  const { data: orgs } = await admin.from("organizations").select("id, name").in("id", [...ids]).order("name");
  return orgs || [];
}
