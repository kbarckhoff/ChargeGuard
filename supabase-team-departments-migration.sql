-- ============================================================
-- Team, departments, invitations + finding department ownership
-- ------------------------------------------------------------
-- One user type. A user belongs to an org and to one or more DEPARTMENTS.
-- Department membership IS the permission scope: you see/act on findings for
-- the departments you belong to (a user in every department sees everything).
-- The platform owner (the firm) can access all orgs. Any user can invite others
-- and set their departments. Findings auto-route to a department by the line's
-- UB-04 revenue code, with manual override.
-- Idempotent: safe to re-run.
-- ============================================================

-- 1) Platform owner flag (the firm's cross-client account) -----------------
alter table users add column if not exists is_platform_owner boolean not null default false;

-- 2) Departments (per org) --------------------------------------------------
create table if not exists departments (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references organizations(id) on delete cascade,
  code       text not null,            -- stable slug (pharmacy, laboratory, ...)
  name       text not null,            -- editable display name
  sort_order int  not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index if not exists idx_departments_org on departments(org_id);

-- 3) User -> department membership (many-to-many) ---------------------------
create table if not exists user_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);
create index if not exists idx_user_departments_user on user_departments(user_id);
create index if not exists idx_user_departments_dept on user_departments(department_id);

-- 4) Invitations ------------------------------------------------------------
create table if not exists invitations (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  email          text not null,
  invited_by     uuid references users(id) on delete set null,
  token          text not null unique,           -- random, used in the email link
  department_ids uuid[] not null default '{}',   -- departments to grant on accept
  status         text not null default 'pending',-- pending | accepted | revoked | expired
  expires_at     timestamptz not null default (now() + interval '14 days'),
  accepted_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_invitations_org on invitations(org_id);
create index if not exists idx_invitations_email on invitations(lower(email));

-- 5) Revenue-code -> department routing map (per org, editable) --------------
-- rev_prefix matches the first 3 digits of a line's UB-04 revenue code.
create table if not exists revenue_code_departments (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  rev_prefix    text not null,          -- '025', '030', ...
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (org_id, rev_prefix)
);
create index if not exists idx_revdept_org on revenue_code_departments(org_id);

-- 6) Finding department ownership + due date --------------------------------
alter table findings add column if not exists owner_department_id uuid references departments(id) on delete set null;
alter table findings add column if not exists due_date date;
create index if not exists idx_findings_owner_dept on findings(owner_department_id);

-- ============================================================
-- SEED: default departments + revenue-code map for every existing org.
-- New orgs get seeded by the app (auth/setup) using the same list.
-- ============================================================
do $$
declare o record;
begin
  for o in select id from organizations loop
    insert into departments (org_id, code, name, sort_order) values
      (o.id,'pharmacy','Pharmacy',10),
      (o.id,'laboratory','Laboratory',20),
      (o.id,'radiology','Radiology/Imaging',30),
      (o.id,'cardiology','Cardiology',40),
      (o.id,'surgery','Surgery/OR & Anesthesia',50),
      (o.id,'emergency','Emergency',60),
      (o.id,'respiratory','Respiratory/Pulmonary',70),
      (o.id,'therapy','Therapy Services',80),
      (o.id,'supply','Supply Chain/Materials',90),
      (o.id,'nursing','Nursing/Clinical',100),
      (o.id,'revenue_cycle','Revenue Cycle/HIM',110),
      (o.id,'unassigned','Unassigned/Other',999)
    on conflict (org_id, code) do nothing;

    insert into revenue_code_departments (org_id, rev_prefix, department_id)
    select o.id, m.pref, d.id
    from (values
      ('025','pharmacy'),('063','pharmacy'),
      ('030','laboratory'),('031','laboratory'),
      ('032','radiology'),('035','radiology'),('040','radiology'),('061','radiology'),
      ('048','cardiology'),('073','cardiology'),
      ('036','surgery'),('037','surgery'),('049','surgery'),('071','surgery'),
      ('045','emergency'),
      ('041','respiratory'),('046','respiratory'),
      ('042','therapy'),('043','therapy'),('044','therapy'),
      ('027','supply'),('062','supply'),
      ('010','nursing'),('011','nursing'),('012','nursing'),('013','nursing'),
      ('014','nursing'),('016','nursing'),('021','nursing'),('076','nursing')
    ) as m(pref, depcode)
    join departments d on d.org_id = o.id and d.code = m.depcode
    on conflict (org_id, rev_prefix) do nothing;
  end loop;
end $$;

-- Make the firm account the platform owner (edit the email if needed).
update users set is_platform_owner = true where lower(email) = 'kbarckhoff@gmail.com';
