// ─── CONVERGE item-master reconciliation (Phase B2) ──────────
// Greg's main use of the item master: catch device / C-code / revenue-code setup
// errors that go both ways between the item master and the chargemaster. We match
// item-master rows to CDM lines (by charge code, else by HCPCS) and flag:
//   • a device / C-code item whose CDM line carries no C-code or device rev code
//   • a revenue-code mismatch between the item master and the CDM for the same item
// Pure function; emits the engine's RuleResult shape.

interface RuleResultLite {
  rule_id: string; charge_item_id: string; title: string; description: string;
  severity: "critical" | "high" | "medium" | "low" | "info"; category: string;
  financial_impact?: number; recommendation: string;
}

export interface ItemMasterRow {
  item_number: string | null; description: string | null; hcpcs: string | null; rev_code: string | null;
  c_code: string | null; is_device: boolean | null; charge_code: string | null; is_active: boolean | null;
}

const norm = (s: any) => String(s ?? "").trim().toUpperCase();
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
// Device/implant revenue codes (0275 pacemaker, 0278 other implants, 0276 intraocular lens, 0624).
const DEVICE_REV = new Set(["0275", "0276", "0278", "0624", "275", "276", "278", "624"]);

export function runItemMasterRules(cdmItems: any[], itemMaster: ItemMasterRow[]): RuleResultLite[] {
  if (!itemMaster?.length) return [];
  // Index CDM lines by charge number and by HCPCS.
  const byCharge = new Map<string, any>();
  const byHcpcs = new Map<string, any>();
  for (const it of cdmItems) {
    const pn = norm(it.procedure_number); if (pn && !byCharge.has(pn)) byCharge.set(pn, it);
    const hc = norm(it.hcpcs_cpt_code); if (hc && !byHcpcs.has(hc)) byHcpcs.set(hc, it);
  }
  const out: RuleResultLite[] = [];
  const seen = new Set<string>();
  for (const im of itemMaster) {
    if (im.is_active === false) continue;
    const cdm = (im.charge_code && byCharge.get(norm(im.charge_code))) || (im.hcpcs && byHcpcs.get(norm(im.hcpcs)));
    if (!cdm) continue;
    const key = `${cdm.id}`;

    // Device / C-code item but the CDM line has no C-code HCPCS and no device rev code.
    const isDevice = im.is_device === true || !!im.c_code;
    const cdmHcpcs = norm(cdm.hcpcs_cpt_code);
    const cdmRev = digits(cdm.revenue_code).padStart(4, "0");
    if (isDevice) {
      const cdmHasC = /^C\d/.test(cdmHcpcs);
      const cdmDeviceRev = DEVICE_REV.has(cdmRev) || DEVICE_REV.has(digits(cdm.revenue_code));
      if (!cdmHasC && !cdmDeviceRev && !seen.has(key + "|dev")) {
        seen.add(key + "|dev");
        out.push({
          rule_id: "IM.device", charge_item_id: cdm.id,
          title: `Item master device not set up as device in CDM`,
          description: `Item master item ${im.item_number ?? ""}${im.c_code ? ` (C-code ${im.c_code})` : ""} maps to CDM line ${cdm.procedure_number ?? ""}, but that line carries no device C-code and no device revenue code.`,
          severity: "high", category: "Item Master Reconciliation",
          recommendation: `Confirm the device setup: the CDM line should carry the device C-code${im.c_code ? ` (${im.c_code})` : ""} and an implant/device revenue code.`,
        });
      }
    }

    // Revenue-code mismatch between item master and CDM for the same item.
    const imRev = digits(im.rev_code);
    if (imRev && cdmRev && digits(im.rev_code).padStart(4, "0") !== cdmRev && !seen.has(key + "|rev")) {
      seen.add(key + "|rev");
      out.push({
        rule_id: "IM.rev", charge_item_id: cdm.id,
        title: `Revenue code differs between item master and CDM`,
        description: `Item master lists revenue code ${im.rev_code} for item ${im.item_number ?? ""}, but the CDM line ${cdm.procedure_number ?? ""} uses ${cdm.revenue_code ?? "(none)"}.`,
        severity: "medium", category: "Item Master Reconciliation",
        recommendation: `Reconcile the revenue code between the item master and the chargemaster; errors go both ways.`,
      });
    }
  }
  return out;
}
