// Device-Procedure Crosswalk reference (Greg Brazzel methodology, Formula Library
// Step 2c). Data generated from CMS_Device_Procedure_Crosswalk_Reference.xlsx via
// scripts/build-device-crosswalk.mjs — a "living reference" updated each January
// from the CMS I/OCE Edit Specs + OPPS device list.

import data from "./device-crosswalk-data.json";
import { normalizeHcpcs } from "./cms-reference";

export interface ProcDevice {
  cpt: string;
  family: string;
  ccodes: string[];
  logic: "AND" | "OR" | "single";
  desc: string;
  risk: string;
}
export interface DeviceCategory {
  category: string;
  keywords: string[];
  ccodes: string[];
  cptFamily: string[];
}

const PROC_TO_DEVICE: Record<string, ProcDevice> = {};
for (const p of data.procToDevice as ProcDevice[]) PROC_TO_DEVICE[normalizeHcpcs(p.cpt)] = p;

export const DEVICE_CATEGORIES = data.deviceCategories as DeviceCategory[];

/** Look up the I/OCE device requirement for a primary procedure CPT. */
export function getProcDevice(hcpcs: string | null | undefined): ProcDevice | null {
  const k = normalizeHcpcs(hcpcs);
  return k ? PROC_TO_DEVICE[k] ?? null : null;
}

/** Classify a Rev 278 device line into a device category by description keyword. */
export function classifyDevice(description: string | null | undefined): DeviceCategory | null {
  const d = (description || "").toUpperCase();
  for (const c of DEVICE_CATEGORIES) {
    if (c.keywords.length && c.keywords.some((k) => d.includes(k))) return c;
  }
  return DEVICE_CATEGORIES.find((c) => /unclassified/i.test(c.category)) ?? null;
}

// ─── Vaccine admin G-codes (Step 2b) ─────────────────────────
export interface Vaccine {
  hcpcs: string; vtype: string; gcode: string; requiresG: boolean; gap: number; note: string;
}
const VACCINES: Record<string, Vaccine> = {};
for (const v of (data.vaccines as Vaccine[]) || []) VACCINES[normalizeHcpcs(v.hcpcs)] = v;
export function getVaccine(hcpcs: string | null | undefined): Vaccine | null {
  const k = normalizeHcpcs(hcpcs);
  return k ? VACCINES[k] ?? null : null;
}

// ─── New / recommended codes (Step: New Codes sheet) ─────────
export interface NewCode {
  code: string; effective: string; desc: string; family: string; priority: string;
}
export const NEW_CODES = (data.newCodes as NewCode[]) || [];
