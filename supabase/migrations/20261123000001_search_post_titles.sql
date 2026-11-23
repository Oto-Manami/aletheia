-- 投稿の題名で探す（Issue #66）
--
-- SNS の投稿は、アカウントごとに情報源を分けずに 1 つの情報源（x など）にまとめて取り込むため、
-- どのアカウントの投稿かは投稿の題名（「表示名 (@アカウント名)」）にだけ入る。素材の文字を探す
-- search_texts とは別に、題名で探せるようにする。
-- - 呼び出した利用者の権限で動くため、見えない投稿は結果に出ない（search_texts と同じ）
-- - 全角・半角などの違いは app.normalize_text でそろえて比べる
-- - 投稿の数は多くないので、索引は作らずに順に比べる（増えたら、そろえた題名の列と索引を足す）

create function public.search_post_titles(query text, max_rows integer default 50)
returns table (
  post_id uuid,
  title text,
  channel_name text,
  published_at timestamptz,
  published_date date
)
language sql stable
security invoker
set search_path = public, extensions
as $$
  select p.id, p.title, ch.name, p.published_at, p.published_date
  from public.posts p
  join public.channels ch on ch.id = p.channel_id
  where p.title is not null
    and app.normalize_text(p.title) &@~ app.normalize_text(query)
  order by coalesce(p.published_at, p.published_date::timestamptz) desc nulls last, p.id
  limit least(greatest(max_rows, 1), 500)
$$;

comment on function public.search_post_titles(text, integer) is
  '投稿の題名で探す。呼び出した利用者の権限で動き、見えない投稿は出ない（Issue #66）';

revoke all on function public.search_post_titles(text, integer) from public, anon;
grant execute on function public.search_post_titles(text, integer) to authenticated;
