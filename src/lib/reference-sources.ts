// ─── Public CMS Reference Source Registry ────────────────────
// Single source of truth for every public data source ChargeGuard benchmarks
// against: its update cadence, the canonical CMS download page, the currently
// loaded vintage, and the logic that computes when the next release is due.
//
// The Benchmarks page renders live status from this registry, and the refresh
// cron (/api/cron/refresh-reference) uses `dueSources()` to decide what to pull.

export type Cadence = "quarterly" | "annual" | "manual";

export interface ReferenceSource {
  key: string;            // stable id used by the refresher + metadata table
  name: string;
  abbr: string;
  cadence: Cadence;
  free: boolean;          // false = licensed (e.g. AMA CPT) — never auto-pulled
  cmsUrl: string;         // canonical CMS download page
  vintage: string;        // human label for the currently loaded release
  effective: string;      // ISO date that loaded release took effect
  note?: string;
}

// Loaded vintages reflect the bundled reference set (extracted from the Apr-2026
// OPPS release cycle). The refresh cron updates these in the metadata table as
// new releases are ingested.
export const REFERENCE_SOURCES: ReferenceSource[] = [
  { key: "addendum_b", name: "OPPS Status Indicators", abbr: "Addendum B", cadence: "quarterly", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient/addendum-and-addendum-b-updates",
    vintage: "2026 April", effective: "2026-04-01" },
  { key: "addendum_a", name: "OPPS APC payment rates", abbr: "Addendum A", cadence: "quarterly", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient/addendum-and-addendum-b-updates",
    vintage: "2026 April", effective: "2026-04-01" },
  { key: "mpfs", name: "Physician Fee Schedule (RVU)", abbr: "MPFS", cadence: "quarterly", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files",
    vintage: "Jan 2026", effective: "2026-01-01", note: "National rates; locality adjustment not yet applied." },
  { key: "clfs", name: "Clinical Lab Fee Schedule", abbr: "CLFS", cadence: "annual", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule/clinical-laboratory-fee-schedule-files",
    vintage: "2026 Q1", effective: "2026-01-01" },
  { key: "asp", name: "Part B ASP drug pricing", abbr: "ASP", cadence: "quarterly", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
    vintage: "Jul 2026", effective: "2026-07-01" },
  { key: "hcpcs", name: "HCPCS quarterly update", abbr: "HCPCS", cadence: "quarterly", free: true,
    cmsUrl: "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update",
    vintage: "2026 Q2", effective: "2026-04-01", note: "New / revised / deleted HCPCS; drives retired-code flags." },
  { key: "vaccine", name: "Vaccine admin fee schedule", abbr: "Vaccine", cadence: "annual", free: true,
    cmsUrl: "https://www.cms.gov/medicare/payment/fee-schedules/part-b-immunization",
    vintage: "2026", effective: "2026-01-01" },
  { key: "cpt", name: "AMA CPT annual update", abbr: "CPT", cadence: "manual", free: false,
    cmsUrl: "https://www.ama-assn.org/practice-management/cpt",
    vintage: "2026", effective: "2026-01-01", note: "AMA-licensed — not a free public download. Supply the CPT file each year." },
];

/** The quarterly release boundaries (month is 0-based for Date). */
const Q_MONTHS = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct

/**
 * The next release date strictly after `from`, for a given cadence.
 * quarterly → next Jan/Apr/Jul/Oct 1; annual → next Jan 1; manual → null.
 */
export function nextRelease(cadence: Cadence, from: Date): Date | null {
  if (cadence === "manual") return null;
  const y = from.getUTCFullYear();
  if (cadence === "annual") {
    // next Jan 1 strictly after `from`
    const jan = Date.UTC(y, 0, 1);
    return new Date(from.getTime() >= jan ? Date.UTC(y + 1, 0, 1) : jan);
  }
  // quarterly
  for (const m of Q_MONTHS) {
    const d = Date.UTC(y, m, 1);
    if (d > from.getTime()) return new Date(d);
  }
  return new Date(Date.UTC(y + 1, 0, 1));
}

export interface SourceStatus extends ReferenceSource {
  nextDue: Date | null;   // when the next release should be ingested
  overdue: boolean;       // a release after the loaded one is already out
  daysUntil: number | null;
}

/** Compute live status for one source relative to `now`. */
export function sourceStatus(s: ReferenceSource, now: Date = new Date()): SourceStatus {
  const eff = new Date(s.effective + "T00:00:00Z");
  const nextDue = nextRelease(s.cadence, eff);
  const overdue = s.cadence !== "manual" && nextDue != null && now.getTime() >= nextDue.getTime();
  const daysUntil = nextDue ? Math.round((nextDue.getTime() - now.getTime()) / 86400000) : null;
  return { ...s, nextDue, overdue, daysUntil };
}

export function allSourceStatus(now: Date = new Date()): SourceStatus[] {
  return REFERENCE_SOURCES.map((s) => sourceStatus(s, now));
}

/** Free, non-manual sources whose next release is already out — what the cron pulls. */
export function dueSources(now: Date = new Date()): SourceStatus[] {
  return allSourceStatus(now).filter((s) => s.free && s.cadence !== "manual" && s.overdue);
}
