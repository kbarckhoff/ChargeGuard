// "Last seen" stamping for the Admin Users "Last login" column.
//
// Supabase Auth's last_sign_in_at only moves on a fresh credential sign-in, so a
// long-lived (token-refreshed) session reads as stale. We stamp activity in two
// places:
//   1. auth app_metadata.last_seen_at — always exists, no migration needed.
//   2. public.users.last_seen_at — used when the column has been migrated.
// The Admin page shows the most recent of sign-in and both stamps.
//
// Uses plain fetch so it runs in middleware (Edge) as well as Node routes.
// Best-effort: never throws.
export async function stampLastSeen(userId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId) return;

  const now = new Date().toISOString();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const results = await Promise.allSettled([
    // GoTrue merges app_metadata keys, so this only touches last_seen_at.
    fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ app_metadata: { last_seen_at: now } }),
    }),
    fetch(`${url}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen_at: now }),
    }),
  ]);

  const [auth, table] = results;
  if (auth.status === "rejected" || (auth.status === "fulfilled" && !auth.value.ok)) {
    console.warn("[last-seen] auth app_metadata stamp failed", auth.status === "fulfilled" ? auth.value.status : auth.reason);
  }
  // A 400 here usually means public.users.last_seen_at hasn't been migrated
  // (supabase-user-last-seen-migration.sql). The auth stamp above still works.
  if (table.status === "fulfilled" && !table.value.ok && table.value.status !== 400) {
    console.warn("[last-seen] users.last_seen_at stamp failed", table.value.status);
  }
}
