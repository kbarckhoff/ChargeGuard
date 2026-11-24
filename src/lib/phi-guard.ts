// ─── PHI guardrail for the claims / remittance inputs ────────
// Converge works on de-identified claim data. This module is the scrub applied to
// the claims extract before anything is stored, in three actions that follow the
// keep / transform / remove model of the De-Identified 835/837 Data Element
// Specification:
//
//   REMOVE     Columns whose header names a direct patient identifier (name, date
//              of birth, SSN, MRN, member / subscriber ID, address, phone, email,
//              and similar) are never read. The parser only keeps the analytic
//              fields it maps, so these columns never leave the browser; this
//              module also keeps them from being mis-mapped into a kept field and
//              reports them back to the user.
//   TRANSFORM  A kept reference field (claim number, line control number) whose
//              VALUE looks like a direct identifier (SSN or Medicare Beneficiary
//              Identifier) is replaced with a stable surrogate, so claim grouping
//              still works but the identifier is not stored.
//   KEEP       Analytic fields: procedure, modifiers, revenue code, units,
//              diagnosis, place of service, amounts, CARC / RARC / group, payer,
//              service date.
//
// NOTE: the element-by-element table in Greg's specification (including the X12
// 5010 segment positions, validation item 9) should be reconciled against the
// lists below once confirmed; they are written from the HIPAA Safe Harbor
// identifier list.
//
// Framework-free: runs in the browser (before upload) and on the server (again,
// as defense in depth).

const normHeader = (h: string) => String(h ?? "").toLowerCase().replace(/[\s_\-./#]/g, "");

// Headers that LOOK patient-related but are analytic fields we keep.
const KEEP_HEADER = /^(patientresp(onsibility)?(amount|amt)?|patientliability(amount|amt)?|patientcontrol(number|no|num)?|patientpaid(amount|amt)?|patientstatus|patienttype|patientclass)$/;

// Direct identifiers (HIPAA Safe Harbor list), matched on the normalized header.
const PHI_HEADER = new RegExp(
  "(" +
    // a person word + an identifying attribute (anchored at the start, so "CPT Number" is not caught by "pt")
    "^(primary|secondary|pri|sec)?(patient|pt|member|subscriber|insured|guarantor|beneficiary|bene|enrollee|dependent|employee|recipient)" +
    "(first|last|middle|full)?(name|dob|birth|ssn|social|address|addr|street|city|zip|postal|phone|tel|email|id|identifier|number|num|no|mrn|account|acct|sex|gender|age)" +
  ")|^(" +
    "name|firstname|lastname|middlename|fullname|surname|dob|dateofbirth|birthdate|birthday|ssn|socialsecurity(number|no)?|" +
    "mrn|medicalrecord(number|no|num)?|medrec(number|no|num)?|mbi|hicn|hic|medicare(id|number|no)|medicaid(id|number|no)|" +
    "memberid|subscriberid|policy(number|no|id)|certificatenumber|accountnumber|acctnumber|acctno|" +
    "address(line)?[12]?|street(address)?|city|county|zip(code)?|postal(code)?|phone(number)?|telephone|mobile|cell|fax|email(address)?|" +
    "driverslicense|licensenumber|ipaddress|deviceserial(number)?|vin|url|photo" +
  ")$"
);

export function isPhiHeader(header: string): boolean {
  const h = normHeader(header);
  if (!h || KEEP_HEADER.test(h)) return false;
  return PHI_HEADER.test(h);
}

/** Split a header row into the PHI columns to remove and the rest. */
export function classifyHeaders(headers: string[]): { phi: string[]; phiIndexes: Set<number> } {
  const phi: string[] = []; const phiIndexes = new Set<number>();
  headers.forEach((h, i) => { if (isPhiHeader(h)) { phi.push(String(h).trim()); phiIndexes.add(i); } });
  return { phi, phiIndexes };
}

// Value patterns for direct identifiers that can hide inside a kept reference field.
const SSN = /^\d{3}-\d{2}-\d{4}$/;
// Medicare Beneficiary Identifier: 11 characters in the CMS position format (dashes optional).
const MBI = /^[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y]{2}\d{2}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeIdentifier(v: string | null | undefined): boolean {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return SSN.test(s) || MBI.test(s) || EMAIL.test(s);
}

/** Stateful scrubber: the same identifier always maps to the same surrogate
 *  within one file, so lines of one claim still group together. */
export function makeScrubber(prefix = "REF") {
  const seen = new Map<string, string>();
  let scrubbed = 0;
  return {
    scrub(v: string | null): string | null {
      if (v == null || !looksLikeIdentifier(v)) return v;
      scrubbed++;
      const k = v.trim().toUpperCase();
      let s = seen.get(k);
      if (!s) { s = `${prefix}-${String(seen.size + 1).padStart(6, "0")}`; seen.set(k, s); }
      return s;
    },
    get count() { return scrubbed; },
  };
}

export interface PhiReport { removedColumns: string[]; transformedValues: number }
