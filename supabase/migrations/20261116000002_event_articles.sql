-- 出来事の記事（設計書 決定記録 0058）
--
-- ライブ・ミーグリなどのまとまりに、運営が書く記事を 1 つ付ける。記事は解釈の層で、閲覧サイトの参加者だけが読む
-- （公開区分は常に private。公開用の書き出しは作らない）。
-- 型の欄（ミーグリの日ごとの服装・内容・同じ日の配信など）の値は sections に持ち、自由記述は body に持つ。

alter table public.articles
  add column event_id uuid references public.events (id),
  add column sections jsonb not null default '{}' check (jsonb_typeof(sections) = 'object');

comment on column public.articles.event_id is '出来事の記事のとき、その出来事（1 つの出来事に 1 つ。決定記録 0058）';
comment on column public.articles.sections is '型の欄の値（ミーグリの日ごとの服装・内容・同じ日の配信など。決定記録 0058）';

create unique index articles_event_id_key on public.articles (event_id) where event_id is not null;
