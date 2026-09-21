-- ============================================================
-- Roles, finding assignment, and audit log
-- ------------------------------------------------------------
-- Adds the RBAC + work-queue model:
--   users.app_role   super_user | analyst | member   (ChargeGuard workflow role,
--                    separate from the legacy user_role enum which we leave alone)
--   users.department display-only label (not tied to any gating yet)
--   findings.assigned_to/by/at   who a finding is assigned to for action
--   finding_activity             the audit log: assign / accept / reject / note
-- Idempotent: safe to re-run.
-- ============================================================

alter table users add column if not exists app_role text not null default 'member';
alter table users add column if not exists department text;
-- The firm's platform owner is the Super User by default.
update users set app_role = 'super_user' where is_platform_owner = true and app_role <> 'super_user';

alter table findings add column if not exists assigned_to uuid references users(id) on delete set null;
alter table findings add column if not exists assigned_by uuid references users(id) on delete set null;
alter table findings add column if not exists assigned_at timestamptz;
create index if not exists idx_findings_assigned_to on findings(assigned_to);

create table if not exists finding_activity (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  audit_id       uuid references audits(id) on delete set null,
  finding_id     uuid references findings(id) on delete cascade,
  actor_id       uuid references users(id) on delete set null,   -- who did it
  action         text not null,                                  -- assigned | unassigned | accepted | rejected | na | note
  assignee_id    uuid references users(id) on delete set null,   -- for assign actions
  note           text,
  action_taken   text,
  effective_date date,
  created_at     timestamptz not null default now()
);
create index if not exists idx_finding_activity_org on finding_activity(org_id);
create index if not exists idx_finding_activity_finding on finding_activity(finding_id);
create index if not exists idx_finding_activity_actor on finding_activity(actor_id);
