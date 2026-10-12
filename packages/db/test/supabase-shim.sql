-- Supabase の外（Docker を使えない環境）でマイグレーションを試すための最小限の代用品。
-- Supabase が用意する auth スキーマとロールのうち、マイグレーションとテストが使う部分だけを再現する。
-- Supabase CLI で立ち上げたデータベースには適用しない。

-- ロールはクラスター全体で共有されるため、作り直しのときは既存のものを使う
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;
grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
