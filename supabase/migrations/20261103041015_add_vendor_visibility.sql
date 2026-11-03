-- Candidate only. Visibility is independent of active/disabled business status.
-- No row rewrite, relation change, policy change or automatic hiding.
begin;
set local lock_timeout = '5s';
alter table public.vendors add column is_hidden boolean not null default false;
comment on column public.vendors.is_hidden is 'User-selected omission from common lists; history and UUID relations remain readable.';
commit;
