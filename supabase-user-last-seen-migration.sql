-- ============================================================
-- Users: last_seen_at
-- ------------------------------------------------------------
-- Supabase Auth's last_sign_in_at only updates on a fresh credential sign-in,
-- so a long-lived (token-refreshed) session shows a stale "last login". We stamp
-- last_seen_at on activity (throttled in middleware) and the Admin Users list
-- shows the most recent of the two, so an actively-logged-in user reads as recent.
-- Idempotent: safe to re-run.
-- ============================================================

alter table users add column if not exists last_seen_at timestamptz;
