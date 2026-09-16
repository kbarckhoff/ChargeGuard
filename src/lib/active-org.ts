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
 * For a platform owner with a valid cg_active_org cookie, returns that org;
 * otherwise returns the user's own org.
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

  if (isPlatformOwner) {
    const picked = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    if (picked && picked !== ownOrg) {
      const { data: o } = await admin.from("organizations").select("id").eq("id", picked).maybeSingle();
      if (o?.id) orgId = o.id;
    }
  }

  return { orgId, ownOrg, isPlatformOwner };
}
