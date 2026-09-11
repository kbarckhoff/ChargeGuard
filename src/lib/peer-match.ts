// ─── Peer-comparison line matching helpers ───────────────────
// Peer transparency files and a hospital CDM are shaped differently: a peer
// lists one gross per code (repeated per payer), while a CDM can reuse the same
// HCPCS across several charge lines at different prices. So matching on the code
// alone can pick the wrong line. These helpers (1) measure how many CDM lines
// share a code and (2) score how well a CDM line's description matches the
// official code descriptor, so we know which line to trust and how much.

import { normalizeHcpcs, getReference } from "./cms-reference";

const STOP = new Set([
  "the", "of", "and", "or", "for", "with", "per", "to", "a", "an", "in", "on",
  "by", "w", "wo", "without", "each", "test", "level", "qual", "quant", "spec",
]);

function tokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

/** Similarity 0..1 between a CDM charge description and the official code
 *  descriptor (short_desc), as the share of descriptor words the CDM line
 *  covers. Returns null when no descriptor is available to compare against. */
export function descMatchScore(chargeDescription: string, code: string): number | null {
  const ref = getReference(code);
  const desc = ref?.short_desc;
  if (!desc) return null;
  const a = tokens(chargeDescription);
  const b = tokens(desc);
  if (b.size === 0) return null;
  let hit = 0;
  for (const w of b) if (a.has(w)) hit++;
  return hit / b.size;
}

export type MatchConfidence = "high" | "medium" | "low" | "n/a";

export function confidenceLabel(score: number | null): MatchConfidence {
  if (score == null) return "n/a";
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

/** Count how many CDM charge lines use each (normalized) HCPCS. */
export function buildCodeMultiplicity(items: { hcpcs_cpt_code?: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = normalizeHcpcs(it.hcpcs_cpt_code || "");
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
