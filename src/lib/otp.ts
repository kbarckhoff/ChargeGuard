// Node-only OTP helpers (used by API route handlers, not middleware).
import crypto from "node:crypto";

/** A 6-digit numeric login code, zero-padded. */
export function genCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** SHA-256 hex of a code, for at-rest storage/compare. */
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(String(code).trim()).digest("hex");
}

/**
 * A readable but strong temporary password for a newly invited user.
 * They are forced to change it on first sign-in.
 */
export function genTempPassword(): string {
  const raw = crypto.randomBytes(12).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
  return "Cg-" + raw.slice(0, 10) + crypto.randomInt(10, 100);
}
