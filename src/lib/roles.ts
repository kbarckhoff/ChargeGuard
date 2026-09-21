// ChargeGuard workflow roles (RBAC), separate from the legacy user_role enum.
//   super_user  the firm / hospital admin: manages users + roles, sees + does all
//   analyst     the Charge Master Analyst: assigns findings to anyone, reviews all
//   member      a regular user: acts on findings assigned to their work queue
export type AppRole = "super_user" | "analyst" | "member";

export const APP_ROLE_LABEL: Record<AppRole, string> = {
  super_user: "Super User",
  analyst: "Charge Master Analyst",
  member: "User",
};

export interface Actor {
  id: string;
  appRole: AppRole;
  isSuper: boolean;   // super user (or platform owner)
  isAnalyst: boolean;
  canAssign: boolean; // may assign findings to others
  fullName: string;
  homeOrg: string | null;
}

// Resolve the caller's workflow role. Pass a service-role (admin) client.
export async function getActor(admin: any, userId: string): Promise<Actor> {
  const { data } = await admin
    .from("users")
    .select("id, app_role, is_platform_owner, full_name, org_id")
    .eq("id", userId)
    .single();
  const isSuper = !!data?.is_platform_owner || data?.app_role === "super_user";
  const isAnalyst = data?.app_role === "analyst";
  return {
    id: userId,
    appRole: (data?.app_role || "member") as AppRole,
    isSuper,
    isAnalyst,
    canAssign: isSuper || isAnalyst,
    fullName: data?.full_name || "",
    homeOrg: data?.org_id || null,
  };
}
