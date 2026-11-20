import { cookies } from "next/headers";
import { PRODUCT } from "./product";

// Platform owners (the firm) can work inside any client org. The "active client"
// is stored in this cookie; every server read/write resolves the org through
// resolveActiveOrg so switching clients re-scopes the whole app. Non-owners are
// always pinned to their own org regardless of the cookie.
//
// Everything here is also brand-partitioned: only organizations whose `product`
// matches this deployment (ChargeGuard vs Converge) are ever visible, so the two
// apps share one database but never see each other's clients or users.

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

  const rawOwnOrg = me?.org_id ?? null;
  const isPlatformOwner = !!me?.is_platform_owner;
  const picked = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value || null;

  // Is a given org part of THIS product? (brand partition)
  const inProduct = async (id: string | null) => {
    if (!id) return false;
    const { data } = await admin.from("organizations").select("id").eq("id", id).eq("product", PRODUCT).maybeSingle();
    return !!data?.id;
  };

  // The user's home org only counts here if it belongs to this product.
  const ownOrg = (await inProduct(rawOwnOrg)) ? rawOwnOrg : null;
  let orgId: string | null = null;

  if (isPlatformOwner) {
    // Owners can switch to any client in this product; the cookie is honored
    // only if it points at a client of this product.
    if (picked && (await inProduct(picked))) orgId = picked;
    if (!orgId) orgId = ownOrg;
    if (!orgId) {
      const { data: first } = await admin
        .from("organizations").select("id").eq("product", PRODUCT).order("name").limit(1).maybeSingle();
      orgId = first?.id ?? null;
    }
  } else {
    // Regular users: only their own org or a membership grant, within this product.
    if (picked && picked !== ownOrg) {
      const { data: m } = await admin
        .from("org_members").select("org_id").eq("user_id", userId).eq("org_id", picked).maybeSingle();
      if (m?.org_id && (await inProduct(picked))) orgId = picked;
    }
    if (!orgId) orgId = ownOrg;
    if (!orgId) {
      // Fall back to the first membership org that belongs to this product.
      const { data: mem } = await admin.from("org_members").select("org_id").eq("user_id", userId);
      const ids = (mem || []).map((m: any) => m.org_id).filter(Boolean);
      if (ids.length) {
        const { data: mo } = await admin
          .from("organizations").select("id").in("id", ids).eq("product", PRODUCT).order("name").limit(1).maybeSingle();
        orgId = mo?.id ?? null;
      }
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
  const { data: orgs } = await admin.from("organizations").select("id, name").in("id", [...ids]).eq("product", PRODUCT).order("name");
  return orgs || [];
}
