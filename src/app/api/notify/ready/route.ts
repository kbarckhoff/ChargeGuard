import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// Fires when a review first has peer price files (status flips to "Ready" on the
// dashboard). Emails every user on the entity, once. Uses Amazon SES via a
// dependency-free SigV4 request; no-ops (no error) until SES env vars are set.
export const dynamic = "force-dynamic";

const hmac = (key: crypto.BinaryLike | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

async function sendSes(region: string, accessKey: string, secretKey: string, from: string, to: string[], subject: string, text: string) {
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({ FromEmailAddress: from, Destination: { ToAddresses: to }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } });
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["POST", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${datestamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(canonicalRequest)].join("\n");
  let k: Buffer = hmac("AWS4" + secretKey, datestamp);
  k = hmac(k, region); k = hmac(k, "ses"); k = hmac(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Amz-Date": amzdate, "X-Amz-Content-Sha256": payloadHash, "Authorization": authorization },
    body,
  });
  if (!res.ok) throw new Error(`SES ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function POST(request: Request) {
  const { auditId } = await request.json().catch(() => ({ auditId: null }));
  if (!auditId) return NextResponse.json({ ok: false, reason: "no auditId" });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

  // Only when peer files actually exist, and only once per review.
  const { count: peerCount } = await db.from("peer_prices").select("id", { count: "exact", head: true }).eq("audit_id", auditId);
  if (!peerCount) return NextResponse.json({ ok: false, reason: "no peer files yet" });

  const { data: audit } = await db.from("audits").select("name, hospital_name, org_id, metadata").eq("id", auditId).single();
  if (!audit) return NextResponse.json({ ok: false, reason: "audit not found" });
  if ((audit.metadata as any)?.ready_notified) return NextResponse.json({ ok: true, already: true });

  const region = process.env.AWS_REGION || "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const from = process.env.SES_FROM;
  if (!accessKey || !secretKey || !from) {
    return NextResponse.json({ ok: false, reason: "SES not configured (set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM)" });
  }

  // Every user on the entity.
  const { data: users } = await db.from("users").select("email").eq("org_id", audit.org_id);
  const recipients = (users || []).map((u) => u.email).filter((e): e is string => !!e);
  if (recipients.length === 0) return NextResponse.json({ ok: false, reason: "no entity users with email" });

  const review = `${audit.name} (${audit.hospital_name})`;
  const subject = `ChargeGuard: ${review} is ready for review`;
  const text = `Peer price-transparency files have been added for ${review}, so the CDM analysis and peer comparison are complete.\n\nThe review is now marked "Ready" on your dashboard. Open it to see the findings and peer analysis.`;
  try {
    await sendSes(region, accessKey, secretKey, from, recipients, subject, text);
    await db.from("audits").update({ metadata: { ...(audit.metadata as any || {}), ready_notified: true } }).eq("id", auditId);
    return NextResponse.json({ ok: true, notified: recipients.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
