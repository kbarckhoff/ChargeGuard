import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { buildScorecard } from "@/lib/scorecard";
import type { OppFinding } from "@/lib/opportunity";
import { buildDecideDeckHtml } from "@/lib/decide-deck";
import { PRODUCT } from "@/lib/product";

export const runtime = "nodejs";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Build the "Decide" exec deck for a review as a self-contained HTML document the
// consultant opens, reviews, and prints to PDF. ?auditId=… (defaults to latest).
// ?download=1 forces a file download; otherwise it renders inline in the browser.
export async function GET(request: Request) {
  const sc = await createSessionClient();
  const { data: { user } } = await sc.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { orgId } = await resolveActiveOrg(db, user.id);
  const url = new URL(request.url);
  const wantedId = url.searchParams.get("auditId");
  const download = url.searchParams.get("download") === "1";

  let audit: any = null;
  if (wantedId) {
    const { data } = await db.from("audits").select("id, name, hospital_name, metadata").eq("org_id", orgId).eq("id", wantedId).maybeSingle();
    audit = data;
  }
  if (!audit) {
    const { data } = await db.from("audits").select("id, name, hospital_name, metadata").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1);
    audit = data?.[0];
  }
  if (!audit) return NextResponse.json({ error: "No review found" }, { status: 404 });

  const findings: OppFinding[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("findings").select("category, financial_impact, severity").eq("audit_id", audit.id).eq("ehr_lagging", false).range(off, off + 999);
    if (error || !data || data.length === 0) break;
    findings.push(...(data as OppFinding[]));
    if (data.length < 1000) break;
  }
  const { count: claimCount } = await db.from("claim_lines").select("id", { count: "exact", head: true }).eq("audit_id", audit.id);
  const sc2 = buildScorecard(findings, { hasClaims: (claimCount || 0) > 0 });

  const md = (audit.metadata as any) || {};
  const html = buildDecideDeckHtml(sc2, {
    product: PRODUCT.name,
    facility: audit.hospital_name || "Hospital",
    period: md.review_period || "Current period",
    generatedAt: new Date().toISOString(),
    referenceVintage: md.reference_vintage || null,
    gateSummary: md.setup_gate_summary || null,
  });

  const safe = String(audit.hospital_name || "facility").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...(download ? { "Content-Disposition": `attachment; filename="converge-decide-deck-${safe}.html"` } : {}),
    },
  });
}
