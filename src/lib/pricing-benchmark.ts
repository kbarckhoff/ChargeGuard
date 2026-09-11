// ─── Peer Pricing Benchmark Layer (Tier 0) ───────────────────
// National and per-state peer charge benchmarks per HCPCS, derived from the
// public CMS "Medicare Outpatient Hospitals - by Geography and Service" file.
// Lets the engine compare a client's gross charge to what other OPPS hospitals
// actually charge (their average submitted charge) for the same code — the
// "defensible pricing" comparison, alongside the Medicare-fee comparison.
//
// Built by scripts/fee-schedules/build-benchmark.mjs. Keyed by normalized HCPCS.

import benchmark from "./pricing-benchmark-data.json";
import { normalizeHcpcs } from "./cms-reference";

export interface BenchmarkStat {
  chg: number;    // average submitted (gross) charge across hospitals
  alwd?: number;  // average Medicare allowed amount
  srvcs?: number; // total services (sample size / weight)
}

interface BenchmarkFile {
  meta?: { source?: string; year?: string | null; generatedAt?: string | null };
  data: Record<string, { natl?: BenchmarkStat; st?: Record<string, BenchmarkStat> }>;
}

const BM = benchmark as BenchmarkFile;
const DATA = BM.data || {};

export interface BenchmarkHit extends BenchmarkStat {
  level: "state" | "national";
  geo?: string; // state code when level === "state"
}

/**
 * Look up the peer charge benchmark for a HCPCS code. Prefers the client's
 * state when a 2-letter `state` is supplied and present; otherwise falls back
 * to the national benchmark. Returns null when the code isn't in the CMS
 * outpatient file (e.g. supplies/drugs not paid under OPPS).
 */
export function getBenchmark(rawHcpcs: string | null | undefined, state?: string | null): BenchmarkHit | null {
  const key = normalizeHcpcs(rawHcpcs);
  if (!key) return null;
  const rec = DATA[key];
  if (!rec) return null;

  if (state) {
    const st = String(state).trim().toUpperCase();
    const s = rec.st?.[st];
    if (s && s.chg > 0) return { ...s, level: "state", geo: st };
  }
  if (rec.natl && rec.natl.chg > 0) return { ...rec.natl, level: "national" };
  return null;
}

export const benchmarkMeta = BM.meta || {};
export const benchmarkCodeCount = Object.keys(DATA).length;
