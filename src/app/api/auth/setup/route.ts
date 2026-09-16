import { NextResponse } from "next/server";

// Self-service provisioning is disabled — ChargeGuard is invite-only. New
// accounts are created by an administrator via /api/team/invite (admin creates
// the auth user with a temporary password and the profile row directly). This
// legacy endpoint, used by the removed public signup page, now refuses.
export async function POST() {
  return NextResponse.json(
    { error: "Signup is disabled. Ask an administrator for an invite." },
    { status: 403 },
  );
}
