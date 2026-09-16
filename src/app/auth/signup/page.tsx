import { redirect } from "next/navigation";

// Self-signup is disabled. ChargeGuard is invite-only — an administrator adds
// each user, who receives a temporary password by email. Any hit to /auth/signup
// is sent to the sign-in page.
export default function SignupDisabled() {
  redirect("/auth/login");
}
