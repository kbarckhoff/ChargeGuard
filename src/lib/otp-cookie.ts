// OTP "verified this session" cookie helpers.
// Uses Web Crypto (crypto.subtle) so the SAME code runs in both the Edge
// middleware and Node route handlers. The value is `${userId}.${expMs}.${hmac}`
// signed with the service-role key (server-only secret; never sent to the client
// beyond the opaque signature).

export const OTP_COOKIE = "cg_otp";

const enc = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Produce the signed cookie value marking the user's session OTP-verified until expMs. */
export async function signOtpValue(userId: string, expMs: number, secret: string): Promise<string> {
  const data = `${userId}.${expMs}`;
  const sig = await crypto.subtle.sign("HMAC", await importKey(secret), enc.encode(data));
  return `${data}.${toHex(sig)}`;
}

/** True when the cookie value is a valid, unexpired signature for this user. */
export async function verifyOtpValue(
  value: string | undefined | null,
  userId: string,
  secret: string,
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [uid, expStr, sig] = parts;
  if (uid !== userId) return false;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;
  const expected = await crypto.subtle.sign("HMAC", await importKey(secret), enc.encode(`${uid}.${expStr}`));
  const expectedHex = toHex(expected);
  // length-safe compare
  if (expectedHex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
