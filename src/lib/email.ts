// Dependency-free Amazon SES sender (SigV4). Uses the classic SES SendRawEmail
// action, which the app's IAM user (chargeguard-ses-smtp) is permitted for
// (ses:SendRawEmail) — no ses:SendEmail permission required.
import crypto from "node:crypto";

const hmac = (key: crypto.BinaryLike | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

export function sesConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.SES_FROM);
}

function buildRawMessage(from: string, to: string[], subject: string, text: string): string {
  // Minimal RFC 5322 plain-text message.
  const lines = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
  ];
  return lines.join("\r\n");
}

// Sends an email via SES SendRawEmail. Returns { ok, reason? }. No-ops (ok:false)
// when SES env vars aren't set, so callers never crash in an unconfigured env.
export async function sendEmail(to: string[], subject: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const from = process.env.SES_FROM;
  const recipients = to.filter((e) => !!e);
  if (!accessKey || !secretKey || !from) return { ok: false, reason: "SES not configured" };
  if (recipients.length === 0) return { ok: false, reason: "no recipients" };

  const host = `email.${region}.amazonaws.com`;
  const rawMessage = buildRawMessage(from, recipients, subject, text);

  // Form-encoded body for the SES query API (SendRawEmail).
  const params = new URLSearchParams();
  params.set("Action", "SendRawEmail");
  params.set("Source", from);
  recipients.forEach((r, i) => params.set(`Destinations.member.${i + 1}`, r));
  params.set("RawMessage.Data", Buffer.from(rawMessage, "utf8").toString("base64"));
  const body = params.toString();

  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${datestamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzdate, scope, sha256hex(canonicalRequest)].join("\n");
  let k: Buffer = hmac("AWS4" + secretKey, datestamp);
  k = hmac(k, region); k = hmac(k, "ses"); k = hmac(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Amz-Date": amzdate, "Authorization": authorization },
    body,
  });
  if (!res.ok) throw new Error(`SES ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { ok: true };
}
