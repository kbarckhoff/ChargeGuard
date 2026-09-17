-- ============================================================
-- Multi-client membership
-- ------------------------------------------------------------
-- A user has one "home" org (users.org_id) but can be granted access to more
-- than one client. org_members is that many-to-many grant. resolveActiveOrg lets
-- a non-owner switch the active client to any org they're a member of; the
-- client switcher lists them. Platform owners still see every org.
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists org_members (
  user_id    uuid not null references users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index if not exists idx_org_members_user on org_members(user_id);
create index if not exists idx_org_members_org  on org_members(org_id);

-- Backfill: every existing user is a member of their home org.
insert into org_members (user_id, org_id)
  select id, org_id from users where org_id is not null
  on conflict do nothing;
