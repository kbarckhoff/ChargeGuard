// Per-client settings stored in organizations.settings (JSONB):
//   run_cadence       "quarterly" = one review per calendar quarter (then locked
//                     until the next quarter); "unlimited" = run anytime (default).
//   access_expires_at ISO date the client's access ends (e.g. 1 year from setup).
//                     null = no expiry.
// The platform owner always bypasses both (they run the firm).

export type RunCadence = "quarterly" | "unlimited";

export interface OrgSettings {
  runCadence: RunCadence;
  accessExpiresAt: string | null;
  accessExpired: boolean;
}

export async function getOrgSettings(admin: any, orgId: string | null): Promise<OrgSettings> {
  if (!orgId) return { runCadence: "unlimited", accessExpiresAt: null, accessExpired: false };
  const { data } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const s = (data?.settings || {}) as any;
  const runCadence: RunCadence = s.run_cadence === "quarterly" ? "quarterly" : "unlimited";
  const accessExpiresAt: string | null = s.access_expires_at || null;
  const accessExpired = !!accessExpiresAt && new Date(accessExpiresAt).getTime() < Date.now();
  return { runCadence, accessExpiresAt, accessExpired };
}

/** Current calendar quarter (UTC). */
export function currentQuarter(now: Date = new Date()): { year: number; quarter: number } {
  return { year: now.getUTCFullYear(), quarter: Math.floor(now.getUTCMonth() / 3) + 1 };
}

export const quarterLabel = (year: number, quarter: number) => `Q${quarter} ${year}`;

/** The quarter that follows the given one (for "unlocks in …" messaging). */
export function nextQuarter(year: number, quarter: number): { year: number; quarter: number } {
  return quarter >= 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 };
}
