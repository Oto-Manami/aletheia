-- 振り分けと「言及なし」の記録（設計書 決定記録 0021）
--
-- - 確認済みの記録（coverage_checks）を、アーカイブに入れなかった記事にも付けられるようにする。
--   投稿の代わりに、情報源の中での記事の ID・日付・URL と、結果（言及あり・言及なし）を持つ
-- - 振り分け待ちの下書きの本文は、変更履歴に残さない（言及の無い記事の本文を残さないため）

-- ---------------------------------------------------------------------------
-- 確認済みの記録
-- ---------------------------------------------------------------------------

alter table public.coverage_checks
  add column external_id text check (btrim(external_id) <> ''),
  add column published_date date,
  add column url text,
  add column result text check (result in ('mention', 'no_mention')),
  drop constraint coverage_checks_check,
  -- 1 件の単位は「投稿」「1 日分」「情報源の中での記事の ID」のどれか。1 日分は他と組み合わせない
  add constraint coverage_checks_unit_check check (
    num_nonnulls(post_id, item_date, external_id) >= 1
    and (item_date is null or num_nonnulls(post_id, external_id) = 0)
  );

create unique index coverage_checks_external_key on public.coverage_checks (channel_id, external_id)
  where external_id is not null;

comment on column public.coverage_checks.external_id is
  '情報源の中での記事の ID。アーカイブに入れなかった記事（振り分けで言及なし）はこれで記録する';
comment on column public.coverage_checks.result is
  '振り分けの結果: mention 言及あり（残した）・no_mention 言及なし（素材は残していない）';

-- ---------------------------------------------------------------------------
-- 振り分け待ちの下書き
-- ---------------------------------------------------------------------------

create index intake_items_triage_idx on public.intake_items (captured_at) where state = 'triage';

-- 振り分け待ちだった下書きを更新・削除したときは、本文（draft）と仮置きのファイルの所在を伏せて履歴に残す。
-- 振り分けで残した下書きは、承認待ちになった後の変更から通常どおり履歴に残る
create or replace function app.record_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_old jsonb := to_jsonb(old);
begin
  if tg_table_schema = 'public' and tg_table_name = 'intake_items' and v_old ->> 'state' = 'triage' then
    v_old := v_old || jsonb_build_object('draft', '{"redacted": true}'::jsonb, 'staged_files', '[]'::jsonb);
  end if;
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
