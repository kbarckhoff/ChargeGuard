import { NextResponse } from "next/server";
import { dueSources, allSourceStatus } from "@/lib/reference-sources";
import { refreshSource, type RefreshOutcome } from "@/lib/reference-refresh";

// Vercel Cron hits this on the CMS release calendar (see vercel.json). It finds
// every free source whose next release is out and refreshes it, validating each
// download before it replaces live data. Guarded by CRON_SECRET so only the
// scheduler (or an authorized manual trigger) can run it.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true; // Vercel Cron sends this
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized (set CRON_SECRET and send it)" }, { status: 401 });
  }

  const url = new URL(req.url);
  // ?dry=1 reports what WOULD refresh without pulling anything.
  const dry = url.searchParams.get("dry") === "1";
  // ?force=<key> refreshes one source regardless of its due date (manual trigger).
  const force = url.searchParams.get("force");

  const due = force
    ? allSourceStatus().filter((s) => s.key === force && s.free && s.cadence !== "manual")
    : dueSources();

  if (dry) {
    return NextResponse.json({
      dry: true,
      now: new Date().toISOString(),
      due: due.map((s) => ({ key: s.key, name: s.name, nextDue: s.nextDue, cmsUrl: s.cmsUrl })),
    });
  }

  const results: RefreshOutcome[] = [];
  for (const s of due) {
    // Each refresher downloads, validates, and (on pass) swaps in the new data.
    // A validation failure keeps the current data and records the error.
    results.push(await refreshSource(s));
  }

  const refreshed = results.filter((r) => r.status === "refreshed");
  const failed = results.filter((r) => r.status === "failed");
  const pending = results.filter((r) => r.status === "parser_pending");

  return NextResponse.json({
    now: new Date().toISOString(),
    checked: due.length,
    refreshed: refreshed.map((r) => ({ key: r.key, rows: r.rows, vintage: r.vintage })),
    failed: failed.map((r) => ({ key: r.key, error: r.error })),
    pending: pending.map((r) => ({ key: r.key, cmsUrl: r.cmsUrl })),
  }, { status: failed.length ? 207 : 200 });
}
