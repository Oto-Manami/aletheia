-- 閲覧サイトの利用者を招待リンクで登録する（設計書 決定記録 0019）
--
-- 管理者が招待を作り、リンクを相手に渡す。相手がリンクを開いて Discord でログインすると、閲覧者として登録される。
-- - 作れるのは管理者だけ。付く役割は閲覧者（viewer）だけ
-- - 1 回限り。作ってから 7 日で切れる。使われる前なら取り消せる
-- - リンクの中の値はデータベースに残さず、照合用の SHA-256 だけを持つ
--
-- 閲覧サイトは app スキーマを直接読めないため、操作はすべて public の関数を通す。
-- 関数は内部の権限（security definer）で動き、最初に呼んだ人の役割を確かめる。

-- ---------------------------------------------------------------------------
-- 招待の表
-- ---------------------------------------------------------------------------

create table app.invites (
  id uuid primary key default gen_random_uuid(),
  -- リンクの中の値の SHA-256（16 進）。値そのものは持たない
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role public.app_role not null default 'viewer' check (role = 'viewer'),
  -- 誰に渡すか（管理者のメモ）
  note text check (char_length(note) <= 100),
  created_by text not null check (created_by ~ '^[0-9]{17,20}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by text check (used_by ~ '^[0-9]{17,20}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((used_at is null) = (used_by is null)),
  check (used_at is null or revoked_at is null)
);

comment on table app.invites is
  '閲覧サイトの招待リンク（設計書 決定記録 0019）。リンクの値は持たず、照合用の SHA-256 だけを持つ';
comment on column app.invites.token_hash is 'リンクの中の値の SHA-256（16 進）';
comment on column app.invites.created_by is '作った管理者の Discord のユーザー ID';
comment on column app.invites.used_by is '使って登録した人の Discord のユーザー ID';

-- 閲覧サイトからは直接読めない（関数を通す）。バックアップでは全行を読む
alter table app.invites enable row level security;
create policy backup_read_all on app.invites for select to aletheia_backup using (true);
grant select on app.invites to aletheia_backup;

create trigger touch_updated_at before update on app.invites
  for each row execute function app.touch_updated_at();
create trigger record_history after update or delete on app.invites
  for each row execute function app.record_history();

-- ---------------------------------------------------------------------------
-- 内部の道具
-- ---------------------------------------------------------------------------

-- リンクの中の値の照合用の値
create function app.invite_token_hash(token text) returns text
language sql immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;

revoke all on function app.invite_token_hash(text) from public;

-- 管理者でなければ止める
create function app.require_admin() returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception '管理者だけが使えます' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function app.require_admin() from public;

-- ---------------------------------------------------------------------------
-- 閲覧サイトから呼ぶ関数
-- ---------------------------------------------------------------------------

-- 招待を作る（管理者）。リンクの中の値は、ここで一度だけ返す
create function public.create_invite(note text default null)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  perform app.require_admin();
  -- 2 つの UUID（いずれも安全な乱数から作られる）をつないだ 64 文字。推測できない長さにする
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into app.invites (token_hash, note, created_by, expires_at)
  values (app.invite_token_hash(v_token), nullif(btrim(note), ''), app.current_discord_user_id(), v_expires)
  returning app.invites.id into v_id;
  return query select v_id, v_token, v_expires;
end;
$$;

comment on function public.create_invite(text) is
  '閲覧サイトの招待を作る（管理者だけ）。リンクの中の値は、このときだけ返す';

-- 招待の一覧（管理者）
create function public.list_invites()
returns table (
  id uuid,
  note text,
  created_by text,
  created_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  used_by text,
  used_by_name text,
  revoked_at timestamptz,
  state text
)
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  return query
    select i.id, i.note, i.created_by, i.created_at, i.expires_at, i.used_at, i.used_by,
           p.display_name,
           i.revoked_at,
           case
             when i.used_at is not null then 'used'
             when i.revoked_at is not null then 'revoked'
             when i.expires_at <= now() then 'expired'
             else 'open'
           end
    from app.invites i
    left join app.user_profiles p on p.discord_user_id = i.used_by
    order by i.created_at desc;
end;
$$;

comment on function public.list_invites() is '閲覧サイトの招待の一覧（管理者だけ）';

-- 招待を取り消す（管理者）。使われる前のものだけ
create function public.revoke_invite(invite_id uuid)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  update app.invites set revoked_at = now()
  where id = invite_id and used_at is null and revoked_at is null;
  if not found then
    raise exception '取り消せる招待がありません（使用済み・取り消し済み・存在しない）'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.revoke_invite(uuid) is '閲覧サイトの招待を、使われる前に取り消す（管理者だけ）';

-- 招待を使う（ログインした人）。閲覧者として登録し、登録された役割を返す。
-- すでに登録のある人が開いても、招待は使わずに今の役割を返す
create function public.accept_invite(token text)
returns public.app_role
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_discord text := app.current_discord_user_id();
  v_role public.app_role;
  v_invite app.invites%rowtype;
  v_name text;
begin
  if v_discord is null then
    raise exception 'Discord でログインしてから開いてください' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role from app.user_profiles p where p.discord_user_id = v_discord;
  if found then
    return v_role;
  end if;

  select * into v_invite from app.invites i
  where i.token_hash = app.invite_token_hash(token)
  for update;
  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001', hint = '招待リンクが正しくありません';
  end if;
  if v_invite.used_at is not null then
    raise exception 'invite_used' using errcode = 'P0001', hint = 'この招待リンクはもう使われています';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = 'P0001', hint = 'この招待リンクは取り消されています';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001', hint = 'この招待リンクは期限が切れています';
  end if;

  -- 表示名は Discord の名前を初期値にする（照合には使わない。管理者があとで変えられる）
  select coalesce(
           nullif(i.identity_data -> 'custom_claims' ->> 'global_name', ''),
           nullif(i.identity_data ->> 'full_name', ''),
           nullif(i.identity_data ->> 'name', ''))
    into v_name
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'discord';

  insert into app.user_profiles (discord_user_id, role, display_name)
  values (v_discord, v_invite.role, left(v_name, 100));
  update app.invites set used_at = now(), used_by = v_discord where id = v_invite.id;
  return v_invite.role;
end;
$$;

comment on function public.accept_invite(text) is
  '招待リンクを使って、ログインした人を閲覧者として登録する。登録済みなら招待を使わずに今の役割を返す';

-- 利用者の一覧（管理者）
create function public.list_members()
returns table (discord_user_id text, role public.app_role, display_name text, created_at timestamptz)
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  return query
    select p.discord_user_id, p.role, p.display_name, p.created_at
    from app.user_profiles p
    order by p.created_at;
end;
$$;

comment on function public.list_members() is '閲覧サイトの利用者の一覧（管理者だけ）';

-- 閲覧者を外す（管理者）。管理者は外せない（運営者が SQL で行う）
create function public.remove_member(member_discord_user_id text)
returns void
language plpgsql volatile
security definer
set search_path = ''
as $$
begin
  perform app.require_admin();
  delete from app.user_profiles p
  where p.discord_user_id = member_discord_user_id and p.role = 'viewer';
  if not found then
    raise exception '外せる閲覧者がいません（管理者は画面からは外せません）'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.remove_member(text) is '閲覧者を外す（管理者だけ。管理者は外せない）';

-- ログインした人だけが呼べる
revoke all on function public.create_invite(text) from public, anon;
revoke all on function public.list_invites() from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.list_members() from public, anon;
revoke all on function public.remove_member(text) from public, anon;
grant execute on function public.create_invite(text) to authenticated;
grant execute on function public.list_invites() to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.list_members() to authenticated;
grant execute on function public.remove_member(text) to authenticated;
