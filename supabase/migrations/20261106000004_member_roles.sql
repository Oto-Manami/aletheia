-- 運営者が、利用者を作業者・閲覧者に切り替える・外す（設計書 決定記録 0032）
--
-- 運営者にする・運営者から外すのは、これまでどおり運営者が SQL で行う（画面からはしない）。

-- 作業者・閲覧者を切り替える（運営者だけ）。運営者は切り替えない
create function public.set_member_role(member_discord_user_id text, new_role public.app_role)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  if new_role not in ('worker', 'viewer') then
    raise exception '画面から付けられるのは作業者と閲覧者だけです（運営者は SQL で付けます）'
      using errcode = 'insufficient_privilege';
  end if;
  update app.user_profiles p
  set role = new_role
  where p.discord_user_id = member_discord_user_id and p.role in ('worker', 'viewer');
  if not found then
    raise exception '切り替えられる利用者がいません（運営者は画面からは切り替えられません）'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.set_member_role(text, public.app_role) is
  '利用者を作業者・閲覧者に切り替える（運営者だけ。運営者は切り替えない）';

revoke all on function public.set_member_role(text, public.app_role) from public, anon;
grant execute on function public.set_member_role(text, public.app_role) to authenticated;

-- 作業者・閲覧者を外す（運営者だけ）。運営者は外せない（運営者が SQL で行う）
create or replace function public.remove_member(member_discord_user_id text)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  delete from app.user_profiles p
  where p.discord_user_id = member_discord_user_id and p.role in ('worker', 'viewer');
  if not found then
    raise exception '外せる利用者がいません（運営者は画面からは外せません）'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.remove_member(text) is '作業者・閲覧者を外す（運営者だけ。運営者は外せない）';
