-- ============================================================
-- Email OTP at sign-in + forced first-login password change
-- ------------------------------------------------------------
-- login_otps stores the 6-digit code emailed after a successful
-- password login. The code is stored hashed (SHA-256); the API
-- verifies it, then issues a short-lived signed cookie that the
-- middleware checks to allow app access.
-- Accessed only by server routes using the service role, which
-- bypasses RLS — RLS is enabled with no policies so nothing is
-- reachable with the anon key.
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists login_otps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null,
  consumed   boolean not null default false,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_otps_user on login_otps(user_id, created_at desc);

alter table login_otps enable row level security;
-- No policies: only the service role (server routes) can read/write.
