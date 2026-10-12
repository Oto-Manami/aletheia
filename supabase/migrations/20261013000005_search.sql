-- 全文検索（PGroonga）
--
-- PGroonga に依存する部分はこのファイルと search_texts 関数に閉じ込める。
-- 将来、別の検索の仕組みに移るときは、この関数の中身を差し替える。

create index asset_texts_search_idx on public.asset_texts
  using pgroonga (normalized_content);

create index entities_search_idx on public.entities
  using pgroonga (canonical_name, reading, aliases);

-- 素材のテキストを検索する。呼び出した利用者の権限で動くため、見えない行は結果に出ない。
-- query は PGroonga のクエリ構文（空白区切りで AND、OR、-除外）
create function public.search_texts(query text, max_rows integer default 50)
returns table (asset_id uuid, text_type text, score double precision, snippet text)
language sql stable
security invoker
set search_path = public, extensions
as $$
  select t.asset_id,
    t.text_type,
    pgroonga_score(t.tableoid, t.ctid) as score,
    array_to_string(
      pgroonga_snippet_html(t.normalized_content, pgroonga_query_extract_keywords(app.normalize_text(query)), 120),
      ' … ') as snippet
  from public.asset_texts t
  where t.normalized_content &@~ app.normalize_text(query)
  order by score desc, t.asset_id
  limit least(greatest(max_rows, 1), 500)
$$;

revoke all on function public.search_texts(text, integer) from public, anon;
grant execute on function public.search_texts(text, integer) to authenticated;
grant execute on function app.normalize_text(text) to authenticated;
-- PGroonga の関数・演算子を使うため（Supabase では既定で付いている）
grant usage on schema extensions to authenticated;
