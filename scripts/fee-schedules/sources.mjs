// CMS fee-schedule source registry — driven by Greg Brazzel's Maintenance Calendar
// (Formula Library Step 16). Each entry tells the refresh pipeline where to look,
// how often, and which reference columns it feeds.
//
// "start small": the three sources that power the rules already built
// (SI / APC / pass-through / retired). The rest of Greg's 17 sources are listed
// at the bottom as `enabled: false` so we can switch them on as parsers are added.
//
// IMPORTANT: `landingUrl` is the stable CMS page. The actual quarterly file link
// lives ON that page and changes each quarter, so `discover()` scrapes the page
// for the newest quarter. Column mappings in each parser are best-effort and must
// be confirmed on the first real download (see README).

export const SOURCES = [
  {
    key: "opps_addendum_b",
    name: "OPPS Addendum B (Status Indicators, APC, Payment Rate)",
    landingUrl:
      "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates",
    cadence: "quarterly", // Jan/Apr/Jul/Oct 1
    feeds: ["si", "apc_payment"], // reference columns this source owns
    fileType: "zip-with-table", // zip containing xlsx/txt
    // The link TEXT is just the month+year (e.g. "April 2026"); the Addendum B
    // distinction lives in the HREF (…/april-2026-addendum-b). Match on the href
    // so we don't pick Addendum A/Q or the generic index page. Newest quarter wins.
    linkMatcher: /-addendum-b$/i,
    parser: "addendumB",
  },
  {
    key: "asp_pricing",
    name: "ASP Drug Pricing (Part B payment limit) + NDC-HCPCS crosswalk",
    landingUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
    cadence: "quarterly",
    feeds: ["asp"],
    fileType: "zip-with-table",
    linkMatcher: /(January|April|July|October)\s+(\d{4}).*ASP|Payment Limit/i,
    parser: "aspPricing",
  },
  {
    key: "hcpcs_quarterly",
    name: "HCPCS Quarterly Update (active code list → retired detection)",
    landingUrl:
      "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update",
    cadence: "quarterly",
    feeds: ["retired", "short_desc"],
    fileType: "zip-with-table",
    linkMatcher: /(January|April|July|October)\s+(\d{4}).*HCPCS/i,
    parser: "hcpcsList",
  },
  {
    key: "mpfs_rvu",
    name: "MPFS RVU file (national fee = RVUs × conversion factor)",
    landingUrl: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files",
    cadence: "quarterly", // RVUnnA (initial) then B/C/D quarterly updates
    feeds: ["mc_fee", "pf_fee"],
    fileType: "zip-with-table",
    linkMatcher: /rvu\d{2}[a-d]$/i, // matches the RVU26A / RVU26B sub-page hrefs
    parser: "mpfsRvu",
    // CY2026 non-QP conversion factor (CMS-1832-F). UPDATE each January from the PFS final rule.
    conversionFactor: 33.40,
  },
  {
    key: "clfs",
    name: "Clinical Lab Fee Schedule (direct payment amounts)",
    landingUrl: "https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files",
    cadence: "quarterly", // YYCLABQn
    feeds: ["clfs"],
    fileType: "zip-with-table",
    linkMatcher: /\d{2}clabq\d$/i, // matches the 26CLABQ1 sub-page hrefs
    parser: "clfsRate",
  },

  // ── Remaining sources from Greg's Maintenance Calendar (enable as parsers land) ──
  { key: "opps_addendum_a", name: "OPPS Addendum A (APC rates)", cadence: "quarterly", enabled: false,
    landingUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates", feeds: ["apc_payment"] },
  { key: "ndc_hcpcs_crosswalk", name: "NDC-HCPCS Crosswalk", cadence: "quarterly", enabled: false,
    landingUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files", feeds: ["ndc"] },
  { key: "device_crosswalk", name: "CMS Procedure-to-Device Crosswalk", cadence: "annual", enabled: false,
    landingUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient", feeds: ["device_ccode"] },
  { key: "vaccine_admin", name: "CMS Vaccine Administration Fee Schedule", cadence: "annual", enabled: false,
    landingUrl: "https://www.cms.gov/medicare/payment/fee-for-service-providers/preventive-services", feeds: ["vaccine_admin_rate"] },
];

export const ENABLED_SOURCES = SOURCES.filter((s) => s.enabled !== false);
