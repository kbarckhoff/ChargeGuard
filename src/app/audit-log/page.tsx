import { redirect } from "next/navigation";

// The Audit Log lives at /change-log (the CDM change history). This legacy path
// redirects there so there's a single Audit Log.
export default function AuditLogRedirect() {
  redirect("/change-log");
}
