import { redirect } from "next/navigation";

// The dashboard now lives at /runs (the blue-sidebar shell). Keep this path
// working for old links by redirecting to it.
export default function LegacyDashboardRedirect() {
  redirect("/runs");
}
