// ChargeGuard scan endpoint.
// Delegates to the v2 engine, which runs the self-contained structural rules
// PLUS the CMS reference-driven rules ported from Greg Brazzel's methodology
// (SI=B / SI=Q1-Q4 packaging, pass-through SI=J/K/G, retired HCPCS, underpriced
// vs fee schedule, bilateral 1.75x). The original v1 engine is preserved in
// route-v1-backup.ts.bak.
export { POST, maxDuration } from "./scan-route-v2";
