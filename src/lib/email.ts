// Dependency-free Amazon SES sender (SigV4). Uses the classic SES SendRawEmail
// action, which the app's IAM user (chargeguard-ses-smtp) is permitted for
// (ses:SendRawEmail) — no ses:SendEmail permission required.
import crypto from "node:crypto";

const hmac = (key: crypto.BinaryLike | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

export function sesConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.SES_FROM);
}

function buildRawMessage(from: string, to: string[], subject: string, text: string, html?: string): string {
  const head = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  if (!html) {
    return [...head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 7bit", "", text].join("\r\n");
  }
  // multipart/alternative: plain-text fallback + branded HTML.
  const boundary = "cg_" + crypto.randomBytes(12).toString("hex");
  const htmlB64 = Buffer.from(html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Branded HTML email template. Email-safe: table layout, inline styles only.
// The logo is referenced from the deployed site so no attachment is needed.
// ---------------------------------------------------------------------------
export function renderEmail(opts: {
  origin?: string;
  title: string;
  paragraphs?: string[];
  code?: string;
  button?: { text: string; url: string };
  footnote?: string;
}): string {
  const origin = opts.origin || "https://chargeguard.ameliormss.com";
  const SLATE = "#1e293b", MUTED = "#64748b", BORDER = "#e2e8f0", BG = "#f4f6f8";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = (opts.paragraphs || []).map(
    (p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${MUTED};">${esc(p)}</p>`
  ).join("");
  const codeBlock = opts.code
    ? `<div style="margin:22px 0;padding:18px;background:#f8fafc;border:1px solid ${BORDER};border-radius:10px;text-align:center;">
         <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:${SLATE};font-family:'DM Mono',Consolas,monospace;">${esc(opts.code)}</div>
       </div>` : "";
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="border-radius:8px;background:${SLATE};">
         <a href="${opts.button.url}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(opts.button.text)}</a>
       </td></tr></table>` : "";
  const footnote = opts.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">${esc(opts.footnote)}</p>` : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:22px 32px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><img src="${origin}/logo-email.png" width="30" height="30" alt="ChargeGuard" style="display:block;border:0;"></td>
            <td style="vertical-align:middle;padding-left:9px;font-size:17px;font-weight:700;color:${SLATE};font-family:'Hanken Grotesk',Arial,sans-serif;">ChargeGuard</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:20px 32px 30px;font-family:'Hanken Grotesk',Arial,sans-serif;">
          <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:${SLATE};">${esc(opts.title)}</h1>
          ${paras}${codeBlock}${button}${footnote}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid ${BORDER};background:#fbfcfd;">
          <p style="margin:0;font-size:11px;color:#94a3b8;font-family:'Hanken Grotesk',Arial,sans-serif;">ChargeGuard by Amelior. This is an automated message, please do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// Sends an email via SES SendRawEmail. Pass html for a branded message (a
// plain-text fallback is included automatically). Returns { ok, reason? }.
// No-ops (ok:false) when SES env vars aren't set.
export async function sendEmail(to: string[], subject: string, text: string, html?: string): Promise<{ ok: boolean; reason?: string }> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const from = process.env.SES_FROM;
  const recipients = to.filter((e) => !!e);
  if (!accessKey || !secretKey || !from) return { ok: false, reason: "SES not configured" };
  if (recipients.length === 0) return { ok: false, reason: "no recipients" };

  const host = `email.${region}.amazonaws.com`;
  const rawMessage = buildRawMessage(from, recipients, subject, text, html);

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
