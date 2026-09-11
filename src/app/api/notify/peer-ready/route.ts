import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// Emails the reviewer when a client finishes Intake -> Imports -> Review Imports,
// so peer price files can be uploaded. Uses Amazon SES via a dependency-free
// SigV4 request. No-ops (no error) until SES env vars are set.
export const dynamic = "force-dynamic";

const TO = "kayleerae@ameliormss.com";

const hmac = (key: crypto.BinaryLike | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

async function sendSes(region: string, accessKey: string, secretKey: string, from: string, to: string, subject: string, text: string) {
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({ FromEmailAddress: from, Destination: { ToAddresses: [to] }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } });
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
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const from = process.env.SES_FROM;
  if (!accessKey || !secretKey || !from) {
    // Not configured yet: don't fail the client's submit.
    return NextResponse.json({ ok: false, reason: "SES not configured (set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM)" });
  }

  let review = "a CDM review";
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await db.from("audits").select("name, hospital_name").eq("id", auditId).single();
    if (data) review = `${data.name} (${data.hospital_name})`;
  } catch { /* keep default */ }

  const subject = `ChargeGuard: ready for peer files — ${review}`;
  const text = `The client has completed Intake, Imports, and Review Imports for ${review}.\n\nPeer price-transparency files are ready to be uploaded in the Peer Setup step. Once loaded and the analysis is run, the findings and peer comparison will appear on the dashboard Findings tab.`;
  try {
    await sendSes(region, accessKey, secretKey, from, TO, subject, text);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
