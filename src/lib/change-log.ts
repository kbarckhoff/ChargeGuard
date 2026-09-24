// Shared mapping from a finding's category to the CDM field/action a change
// would touch. Used both when accepting a finding (to stage a change) and on
// scan (to recognise a re-found finding that matches an already-approved change).

export type ChangeField = "price" | "description" | "revenue_code" | "modifier" | "hcpcs" | "review";
export type ChangeAction = "add" | "modify" | "deactivate";

export function changeFieldForCategory(category: string | null | undefined): ChangeField {
  const cat = (category || "").toLowerCase();
  if (/pric|markup|clfs|billing unit|multiplier|leakage/.test(cat)) return "price";
  if (/description/.test(cat)) return "description";
  if (/revenue code/.test(cat)) return "revenue_code";
  if (/modifier/.test(cat)) return "modifier";
  if (/retired|missing code|coding|hcpcs|crosswalk|device/.test(cat)) return "hcpcs";
  return "review";
}

export function changeActionForCategory(category: string | null | undefined): ChangeAction {
  const cat = (category || "").toLowerCase();
  if (/retired|inactive|deactivat|self-admin/.test(cat)) return "deactivate";
  if (/missing code|new .*code|recommended code|add-on|missing primary/.test(cat)) return "add";
  return "modify";
}

// Change-log lifecycle statuses that mean "accepted and worked, but not yet
// confirmed present in the latest CDM" — these drive the lagging/Pending-Sync
// view. "implemented" = the assignee marked it done (awaiting confirmation);
// "approved_missing" = a later run couldn't find it; "exported" = legacy sent.
// "verified" is excluded: a later run confirmed it, so it's fully done.
export const AWAITING_SYNC_STATUSES = ["exported", "implemented", "approved_missing"] as const;
