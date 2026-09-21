// Pharmacy detection for peer/benchmark pricing.
// Formularies differ across otherwise-comparable hospitals, so drug/pharmacy
// lines can't be benchmarked on gross charge against peers. Peer and CMS
// benchmark rules use this to drop pharmacy lines from the market comparison.
//
// A line is treated as pharmacy when:
//   - its UB-04 revenue code is a pharmacy family (025x = pharmacy, 063x =
//     drugs requiring detailed coding / self-administered), OR
//   - its charge code appears in the uploaded formulary (any drug on formulary).

/** UB-04 pharmacy revenue-code families (normalized to a 3-digit family). */
export function isPharmacyRevCode(revenueCode: string | null | undefined): boolean {
  const digits = String(revenueCode || "").replace(/\.0+$/, "").replace(/\D/g, "");
  if (!digits) return false;
  const four = digits.length >= 4 ? digits.slice(0, 4) : digits.padStart(4, "0");
  const fam = four.slice(0, 3);
  return fam === "025" || fam === "063";
}

/**
 * Is this CDM line a pharmacy line that should be excluded from peer pricing?
 * `formularyCodes` is the set of charge codes present in the uploaded formulary.
 */
export function isPharmacyLine(item: any, formularyCodes?: Set<string> | null): boolean {
  if (isPharmacyRevCode(item?.revenue_code)) return true;
  if (formularyCodes && formularyCodes.size) {
    const code = String(item?.procedure_number || "").trim();
    if (code && formularyCodes.has(code)) return true;
  }
  return false;
}
