// /dashboard is a legacy path that immediately redirects to /runs (the real
// sidebar app shell). It must NOT render the old TopNav header, otherwise that
// header flashes for a moment during the redirect on first load. So this layout
// is a bare pass-through.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
