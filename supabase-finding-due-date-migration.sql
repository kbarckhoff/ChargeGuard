-- Optional due date captured when a finding is accepted/assigned.
-- Safe to run multiple times.
alter table findings add column if not exists due_date date;
