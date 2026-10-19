-- 閲覧サイトが、ログインした人自身の登録（役割）を読むための関数
--
-- app スキーマは閲覧サイトから直接読めないため、public に窓口を置く。
-- 利用者の権限のまま動き（security invoker）、自分の登録だけが返る（app.user_profiles の行レベルセキュリティ）。
-- 登録の無い人には何も返らない。

create function public.my_profile()
returns table (role public.app_role, discord_user_id text, display_name text)
language sql stable
security invoker
set search_path = ''
as $$
  select p.role, p.discord_user_id, p.display_name
  from app.user_profiles p
  where p.discord_user_id = app.current_discord_user_id()
$$;

comment on function public.my_profile() is 'ログインした人自身の、閲覧サイトの利用者としての登録';

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
