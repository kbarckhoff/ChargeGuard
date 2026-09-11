// Dependency-free Amazon SES v2 sender (SigV4). Mirrors the inline sender in
// notify/ready so other routes (e.g. invitations) can send mail too.
import crypto from "node:crypto";

const hmac = (key: crypto.BinaryLike | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

export function sesConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.SES_FROM);
}

// Sends an email. Returns { ok, reason? }. No-ops (ok:false) when SES env vars
// are not set, so callers never crash in a dev/unconfigured environment.
export async function sendEmail(to: string[], subject: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const from = process.env.SES_FROM;
  const recipients = to.filter((e) => !!e);
  if (!accessKey || !secretKey || !from) return { ok: false, reason: "SES not configured" };
  if (recipients.length === 0) return { ok: false, reason: "no recipients" };

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({ FromEmailAddress: from, Destination: { ToAddresses: recipients }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } });
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
  return { ok: true };
}
