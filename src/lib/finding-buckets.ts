// Findings are grouped into four exportable views on the Findings page:
//   cdm       — chargemaster coding / pricing / structure findings (the default)
//   rvu       — RVU / low-volume analysis
//   formulary — pharmacy / drug billing-unit / NDC / formulary findings
//   peer      — peer-review (competitor & CMS benchmark) pricing analysis
//
// Bucketing is by the finding's category string so it stays in sync as rules are
// added, without a per-rule registry.

export type FindingBucket = "cdm" | "rvu" | "formulary" | "peer";

export const BUCKET_LABELS: Record<FindingBucket, string> = {
  cdm: "CDM Findings",
  rvu: "RVU Findings",
  formulary: "Formulary Findings",
  peer: "Peer Review Findings",
};

export function bucketForCategory(category: string | null | undefined): FindingBucket {
  const c = (category || "").toLowerCase();
  if (c.startsWith("rvu")) return "rvu";
  if (/pharm|drug|formulary|\bndc\b|billing unit|multiplier|\buom\b|self-admin|\bpbu\b/.test(c)) return "formulary";
  if (/peer|competitor|benchmark|transparency|shoppable/.test(c)) return "peer";
  return "cdm";
}

// Given every category present, return the list that falls in a bucket — used to
// build an `.in("category", [...])` filter for the findings query.
export function categoriesInBucket(allCategories: string[], bucket: FindingBucket): string[] {
  return allCategories.filter((c) => bucketForCategory(c) === bucket);
}
