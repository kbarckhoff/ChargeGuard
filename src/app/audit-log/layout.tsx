// /audit-log is now the same as the Audit Log (formerly Change Log). This route
// just redirects there, so it renders no chrome of its own.
export default function AuditLogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
