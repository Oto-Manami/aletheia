-- 変更履歴
--
-- 更新・削除の前の行を、トリガーで自動的に保存する。履歴は追記のみで、
-- 更新・削除・全件削除はできない（所有者でも不可）。

create table app.history (
  id bigint generated always as identity primary key,
  table_schema text not null,
  table_name text not null,
  row_id uuid not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  old_row jsonb not null,
  changed_at timestamptz not null default now(),
  -- 閲覧サイト経由ならログインした利用者、直接接続なら null
  changed_by uuid,
  db_user text not null default current_user
);
comment on table app.history is '変更・削除の前の状態。追記のみ';

create index history_row_idx on app.history (table_name, row_id);

create function app.record_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_old jsonb := to_jsonb(old);
begin
  insert into app.history (table_schema, table_name, row_id, operation, old_row, changed_by)
  values (
    tg_table_schema,
    tg_table_name,
    coalesce(v_old ->> 'id', v_old ->> 'user_id')::uuid,
    tg_op,
    v_old,
    (claims::jsonb ->> 'sub')::uuid
  );
  return null;
end;
$$;

create function app.reject_history_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '変更履歴は追記のみです（%）', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger history_append_only
  before update or delete on app.history
  for each row execute function app.reject_history_change();

create trigger history_no_truncate
  before truncate on app.history
  for each statement execute function app.reject_history_change();

-- 公開スキーマのすべての表と、利用者の表に履歴のトリガーを付ける
do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'app' and c.relname = 'user_profiles'))
  loop
    execute format(
      'create trigger record_history after update or delete on %s for each row execute function app.record_history()',
      t);
  end loop;
end;
$$;
