// Findings are grouped into exportable views (tabs) on the Findings page. Each
// import file now has a home, so a reviewer can see what each input produced:
//   cdm            — chargemaster coding / pricing / structure findings (the default)
//   charge_capture — missed and mismatched charges inferred from the claims extract
//                    (Greg's companion-charge rules CC-1 … CC-13)
//   claims         — denials, pricing vs paid, NCCI / MUE edits and other claim-logic findings
//   item_master    — item master vs chargemaster reconciliation
//   formulary      — pharmacy / drug billing-unit / NDC / formulary findings
//   rvu            — RVU / low-volume analysis
//   peer           — peer-review (competitor & CMS benchmark) pricing analysis
//
// Bucketing is by the finding's category string so it stays in sync as rules are
// added, without a per-rule registry.

export type FindingBucket = "cdm" | "charge_capture" | "claims" | "item_master" | "formulary" | "rvu" | "peer";

// Display order of the tabs (and of the sheets in the findings export).
export const BUCKET_ORDER: FindingBucket[] = ["cdm", "charge_capture", "claims", "item_master", "formulary", "rvu", "peer"];

export const BUCKET_LABELS: Record<FindingBucket, string> = {
  cdm: "CDM Findings",
  charge_capture: "Charge Capture",
  claims: "Claims & Denials",
  item_master: "Item Master",
  formulary: "Formulary Findings",
  rvu: "RVU Findings",
  peer: "Peer Review Findings",
};

// The import file a tab depends on, shown in the tab's empty state so a blank tab
// reads as "this input was not supplied", not "nothing was found".
export const BUCKET_INPUT: Record<FindingBucket, string> = {
  cdm: "Charge Master (CDM)",
  charge_capture: "Claims Extract",
  claims: "Claims Extract",
  item_master: "Item Master",
  formulary: "Formulary",
  rvu: "Revenue & Usage",
  peer: "peer price files",
};

export function bucketForCategory(category: string | null | undefined): FindingBucket {
  const c = (category || "").toLowerCase();
  if (c.startsWith("rvu")) return "rvu";
  if (c.startsWith("charge capture")) return "charge_capture";
  if (c.startsWith("item master")) return "item_master";
  if (/\(claims\)|denial|ncci|\bmue\b/.test(c)) return "claims";
  if (/pharm|drug|formulary|\bndc\b|billing unit|multiplier|\buom\b|self-admin|\bpbu\b/.test(c)) return "formulary";
  if (/peer|competitor|benchmark|transparency|shoppable/.test(c)) return "peer";
  return "cdm";
}

// Given every category present, return the list that falls in a bucket — used to
// build an `.in("category", [...])` filter for the findings query.
export function categoriesInBucket(allCategories: string[], bucket: FindingBucket): string[] {
  return allCategories.filter((c) => bucketForCategory(c) === bucket);
}
