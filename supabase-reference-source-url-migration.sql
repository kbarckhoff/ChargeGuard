-- Reference-source freshness metadata: store the exact CMS file URL each source
-- loaded, plus ensure last_checked exists. Lets the References page show the real
-- release + a link to verify, and when the last refresh was attempted.
-- Safe to run multiple times.
alter table cms_reference_sources add column if not exists source_url text;
alter table cms_reference_sources add column if not exists last_checked timestamptz;
