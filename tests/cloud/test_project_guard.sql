-- Install only in the dedicated cloud test project. Never install in main.
do $test$
begin
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test')
     or exists (select 1 from storage.buckets where id = 'factory-photos') then
    raise exception 'Unsafe project: expected only the dedicated test photo bucket';
  end if;
end
$test$;
create schema test_guard;
create table test_guard.project_identity (
  project_ref text primary key,
  created_at timestamptz not null default now(),
  constraint expected_test_ref check (project_ref = 'zfcsuxihpakrsohvcwlr')
);
insert into test_guard.project_identity (project_ref) values ('zfcsuxihpakrsohvcwlr');
revoke all on schema test_guard from public, anon, authenticated;
revoke all on test_guard.project_identity from public, anon, authenticated;
