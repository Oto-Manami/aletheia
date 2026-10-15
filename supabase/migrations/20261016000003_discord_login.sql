-- 閲覧サイトのログインを Discord のアカウントにする（設計書 決定記録 0010）
--
-- 利用者は Discord のユーザー ID で登録する。運営者は、相手が一度もログインしていなくても登録できる。
-- ログインした人の Discord のユーザー ID は、Supabase の認証の記録（auth.identities）から読む。
-- 利用者が自分で書き換えられるプロフィールの値（user_metadata）は使わない。

-- ---------------------------------------------------------------------------
-- 利用者の表を、Discord のユーザー ID で登録する形にする
-- ---------------------------------------------------------------------------

-- 本番の利用者の登録はまだ無い前提。登録があれば、移し替えを考えるために止める
do $$
begin
  if exists (select 1 from app.user_profiles) then
    raise exception 'app.user_profiles に行があります。Discord のユーザー ID への移し替えを先に決めてください';
  end if;
end;
$$;

drop policy read_own_profile on app.user_profiles;

alter table app.user_profiles
  drop constraint user_profiles_pkey,
  drop column user_id,
  add column id uuid primary key default gen_random_uuid(),
  -- Discord のユーザー ID（数字のみ。17〜20 桁）
  add column discord_user_id text not null unique check (discord_user_id ~ '^[0-9]{17,20}$');

comment on table app.user_profiles is '閲覧サイトの利用者（Discord のユーザー ID で登録する）と役割';
comment on column app.user_profiles.discord_user_id is
  'Discord のユーザー ID。ログインした人の照合は auth.identities の記録で行う';

-- ---------------------------------------------------------------------------
-- ログインした人の照合
-- ---------------------------------------------------------------------------

-- ログインしている人の Discord のユーザー ID。Discord でログインしていなければ null
create function app.current_discord_user_id() returns text
language sql stable security definer
set search_path = ''
as $$
  select i.provider_id
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'discord'
$$;

create or replace function app.is_member() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.user_profiles p where p.discord_user_id = app.current_discord_user_id()
  )
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' from app.user_profiles p
     where p.discord_user_id = app.current_discord_user_id()),
    false)
$$;

revoke all on function app.current_discord_user_id() from public;
grant execute on function app.current_discord_user_id() to authenticated;

create policy read_own_profile on app.user_profiles for select to authenticated
  using (discord_user_id = app.current_discord_user_id());
