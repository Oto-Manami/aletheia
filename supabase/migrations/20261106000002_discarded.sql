-- 「言及なし」にした直近 10 件の置き場（設計書 決定記録 0031）

-- 直近のものから並べる・古いものを消すための索引
create index intake_items_discarded_idx on public.intake_items (reviewed_at desc)
  where state = 'discarded';

-- 振り分け待ち・言及なしの置き場にあった下書きを更新・削除したときは、本文（draft）と仮置きの
-- ファイルの所在を伏せて履歴に残す（言及の無い記事の本文をためないため。決定記録 0021）
create or replace function app.record_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_old jsonb := to_jsonb(old);
begin
  if tg_table_schema = 'public' and tg_table_name = 'intake_items'
     and v_old ->> 'state' in ('triage', 'discarded') then
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
