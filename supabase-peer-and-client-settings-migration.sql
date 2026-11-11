-- Per-user permission to add peer / price-transparency files, plus notes on the
-- per-client settings (run cadence + access expiry) that live in the existing
-- organizations.settings JSONB (no column needed for those).
--
-- organizations.settings shape used by the app:
--   { "run_cadence": "quarterly" | "unlimited",
--     "access_expires_at": "2027-11-05T00:00:00.000Z" | null }
--
-- Safe to run multiple times.

-- Who may add peer files. Super users and analysts can always; this flag lets the
-- admin grant it to any other user too (e.g. a client's own staff). getActor OR's
-- this with the role check.
alter table users add column if not exists can_manage_peers boolean not null default false;
