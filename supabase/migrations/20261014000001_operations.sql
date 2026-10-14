-- 解釈の層と運用の表（データモデル v2 の 7 章・8 章）
--
--   notes / articles / article_refs     人のメモ・記事（事実を参照して作る）
--   coverage_lenses / coverage_scopes   収集カバレッジの観点と、観点 × 情報源の対象範囲
--   coverage_checks                     アイテム単位の確認済みの記録
--   coverage_candidates                 仕事の記録漏れの候補（告知から拾えなかったもの）
--   merge_candidates                    重複の疑い
--   jobs / job_runs                     定期処理の定義と実行記録（止まっているものの検知）
--   quality_issues                      データ品質の検査で見つかった問題

-- ---------------------------------------------------------------------------
-- 表を守る設定をまとめて付ける
--
-- 公開区分による行レベルセキュリティ、バックアップ用の読み取り、閲覧サイトからの読み取り、
-- 変更履歴と updated_at のトリガー。これから作る表にも必ず使う。
-- ---------------------------------------------------------------------------

create function app.protect_table(t regclass) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format(
    'create policy read_within_clearance on %s for select to authenticated '
    'using (classification <= app.current_clearance())', t);
  execute format('create policy backup_read_all on %s for select to aletheia_backup using (true)', t);
  execute format('grant select on %s to authenticated, aletheia_backup', t);
  execute format(
    'create trigger touch_updated_at before update on %s for each row execute function app.touch_updated_at()', t);
  execute format(
    'create trigger record_history after update or delete on %s for each row execute function app.record_history()', t);
end;
$$;

revoke all on function app.protect_table(regclass) from public;

-- 種類ごとに異なる表を参照する列（target_type / target_id）の参照先が実在するか
create function app.ref_exists(kind text, ref uuid) returns boolean
language plpgsql stable
set search_path = ''
as $$
begin
  return case kind
    when 'post' then exists (select 1 from public.posts where id = ref)
    when 'asset' then exists (select 1 from public.assets where id = ref)
    when 'entity' then exists (select 1 from public.entities where id = ref)
    when 'event' then exists (select 1 from public.events where id = ref)
    when 'statement' then exists (select 1 from public.statements where id = ref)
    when 'term' then exists (select 1 from public.terms where id = ref)
    when 'article' then exists (select 1 from public.articles where id = ref)
    else false
  end;
end;
$$;

revoke all on function app.ref_exists(text, uuid) from public;

-- 参照先の実在を確かめるトリガー。引数は（種類の列名, ID の列名）
create function app.check_ref() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  row_json jsonb := to_jsonb(new);
  kind text := row_json ->> tg_argv[0];
  ref uuid := (row_json ->> tg_argv[1])::uuid;
begin
  if ref is not null and not app.ref_exists(kind, ref) then
    raise exception '%: % % が存在しません', tg_table_name, kind, ref
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 解釈の層
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'asset', 'entity', 'event', 'statement')),
  target_id uuid not null,
  body text not null check (btrim(body) <> ''),
  author_id uuid,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notes is '素材・出来事・エンティティ・言明への人のメモ・感想・補足（解釈の層）';

create index notes_target_idx on public.notes (target_type, target_id);

create trigger notes_check_target before insert or update of target_type, target_id on public.notes
  for each row execute function app.check_ref('target_type', 'target_id');

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (btrim(title) <> ''),
  -- 本文。素材・出来事・言明は {{asset:<id>}} などの形で参照する
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_id uuid,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
comment on table public.articles is '記事。事実（素材・出来事・言明）を参照して組み立てる（解釈の層）';

create table public.article_refs (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  ref_type text not null check (ref_type in ('post', 'asset', 'entity', 'event', 'statement')),
  ref_id uuid not null,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, ref_type, ref_id)
);
comment on table public.article_refs is '記事が参照している事実。記事化に使った素材を記事から逆引きできる';

create index article_refs_ref_idx on public.article_refs (ref_type, ref_id);

create trigger article_refs_check_ref before insert or update of ref_type, ref_id on public.article_refs
  for each row execute function app.check_ref('ref_type', 'ref_id');

-- メモ・記事から参照されている事実は、先に参照を外さないと削除できない
create or replace function app.prevent_orphan_links() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kind text := tg_argv[0];
begin
  if exists (
    select 1 from public.links
    where (kind in ('post', 'asset') and from_type = kind and from_id = old.id)
       or (kind in ('entity', 'event', 'term') and to_type = kind and to_id = old.id)
  ) then
    raise exception 'links から参照されている % % は削除できません', kind, old.id
      using errcode = 'foreign_key_violation';
  end if;
  if exists (select 1 from public.notes where target_type = kind and target_id = old.id)
     or exists (select 1 from public.article_refs where ref_type = kind and ref_id = old.id) then
    raise exception 'メモ・記事から参照されている % % は削除できません', kind, old.id
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

create trigger statements_prevent_orphan_links before delete on public.statements
  for each row execute function app.prevent_orphan_links('statement');

-- ---------------------------------------------------------------------------
-- 収集カバレッジ
-- ---------------------------------------------------------------------------

create table public.coverage_lenses (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (app.is_key(key)),
  name text not null,
  description text,
  -- 読んで該当があったときに何を記録するか
  records text,
  position integer not null default 0,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.coverage_lenses is '収集カバレッジの観点（素材を読むときに何を探すか）';

create table public.coverage_scopes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id),
  lens_id uuid not null references public.coverage_lenses (id),
  in_scope boolean not null,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, lens_id)
);
comment on table public.coverage_scopes is '観点 × 情報源のマトリクス。対象外の組み合わせは in_scope = false';

create index coverage_scopes_lens_idx on public.coverage_scopes (lens_id);

create table public.coverage_checks (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id),
  -- 1 件の単位: 投稿・回・号は post_id、1 日分は item_date（JST の暦日）
  post_id uuid references public.posts (id),
  item_date date,
  -- 確認した観点。後から観点を足したとき、未確認の観点が分かる
  lens_keys text[] not null check (cardinality(lens_keys) > 0),
  checked_by uuid,
  checked_at timestamptz not null default now(),
  note text,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(post_id, item_date) = 1)
);
comment on table public.coverage_checks is 'アイテム単位（記事 1 本・1 日分・番組 1 回など）の確認済みの記録';

create unique index coverage_checks_post_key on public.coverage_checks (channel_id, post_id) where post_id is not null;
create unique index coverage_checks_day_key on public.coverage_checks (channel_id, item_date) where item_date is not null;
create index coverage_checks_post_idx on public.coverage_checks (post_id);

create table public.coverage_candidates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'overdue_announcement', -- 日付を過ぎても告知のみの出来事
    'regular_gap',          -- 定期的な仕事の欠け
    'mention_hint',         -- 発言・言及の中の手がかり
    'co_star_hint',         -- 共演者からの手がかり
    'orphan_asset'          -- 出来事に紐付いていない素材
  )),
  -- 同じ候補を繰り返し出さないための識別子（検出の規則が決める）
  fingerprint text not null unique,
  summary text not null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  state text not null default 'pending' check (state in ('pending', 'event_created', 'not_appeared', 'out_of_scope')),
  event_id uuid references public.events (id),
  decided_by uuid,
  decided_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state = 'pending' or decided_at is not null),
  check (state <> 'event_created' or event_id is not null)
);
comment on table public.coverage_candidates is '仕事の記録漏れの候補。「出演なし」「対象外」も記録として残す';

create index coverage_candidates_pending_idx on public.coverage_candidates (created_at) where state = 'pending';
create index coverage_candidates_event_idx on public.coverage_candidates (event_id);

-- ---------------------------------------------------------------------------
-- 重複の疑い
-- ---------------------------------------------------------------------------

create table public.merge_candidates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('entity', 'asset')),
  -- 組を一意にするため、小さい ID を left_id に置く
  left_id uuid not null,
  right_id uuid not null,
  score numeric(4, 3) check (score between 0 and 1),
  evidence jsonb,
  state text not null default 'pending' check (state in ('pending', 'merged', 'distinct')),
  decided_by uuid,
  decided_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, left_id, right_id),
  check (left_id < right_id),
  check (state = 'pending' or decided_at is not null)
);
comment on table public.merge_candidates is '重複の疑い（人物の表記違い、似た画像など）。確認して統合するか別物とする';

create index merge_candidates_right_idx on public.merge_candidates (kind, right_id);

create trigger merge_candidates_check_left before insert or update of kind, left_id on public.merge_candidates
  for each row execute function app.check_ref('kind', 'left_id');
create trigger merge_candidates_check_right before insert or update of kind, right_id on public.merge_candidates
  for each row execute function app.check_ref('kind', 'right_id');

-- ---------------------------------------------------------------------------
-- 定期処理
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (app.is_key(key)),
  name text not null,
  -- この間隔を超えて成功していなければ「止まっている」とみなす
  expected_interval interval not null check (expected_interval > interval '0'),
  enabled boolean not null default true,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.jobs is '定期処理（取り込み・バックアップ・検査など）の定義';

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  items_processed integer check (items_processed >= 0),
  error text,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'running' or finished_at is not null),
  check (finished_at is null or finished_at >= started_at)
);
comment on table public.job_runs is '定期処理の実行記録（ハートビート）';

create index job_runs_job_idx on public.job_runs (job_id, started_at desc);

-- 止まっている定期処理（有効なのに、期待する間隔のうちに成功していない）
create view app.stale_jobs with (security_invoker) as
select j.key, j.name, j.expected_interval, last.finished_at as last_succeeded_at
from public.jobs j
left join lateral (
  select r.finished_at from public.job_runs r
  where r.job_id = j.id and r.status = 'succeeded'
  order by r.finished_at desc limit 1
) last on true
where j.enabled
  and (last.finished_at is null or last.finished_at < now() - j.expected_interval);

-- ---------------------------------------------------------------------------
-- データ品質
-- ---------------------------------------------------------------------------

create table public.quality_issues (
  id uuid primary key default gen_random_uuid(),
  check_key text not null check (app.is_key(check_key)),
  target_type text not null check (target_type in ('post', 'asset', 'entity', 'event', 'statement', 'channel', 'asset_file')),
  target_id uuid not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  state text not null default 'open' check (state in ('open', 'resolved', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (check_key, target_type, target_id),
  check (state = 'open' or resolved_at is not null)
);
comment on table public.quality_issues is 'データ品質の検査で見つかった問題。検査のたびに更新し、直ったものは resolved にする';

create index quality_issues_open_idx on public.quality_issues (severity, check_key) where state = 'open';

-- データ品質の検査
--
-- | check_key              | 重さ    | 内容                                                       |
-- |------------------------|---------|------------------------------------------------------------|
-- | asset_without_post     | warning | 投稿に属さない素材（出典をたどりにくい）                   |
-- | stored_without_file    | error   | ファイルを保存するはずの素材に、原本のファイルの記録が無い   |
-- | file_unverified        | warning | 原本のファイルを 90 日以上照合していない                    |
-- | asset_unlinked         | warning | 人物・出来事・語彙のどれにも紐付いていない素材             |
-- | statement_without_evidence | warning | 根拠の素材が無い言明                                   |
-- | overdue_announcement   | warning | 日付を過ぎても出演が予定のままの出来事                     |
-- | entity_unused          | info    | どこからも参照されていない人物・作品など                   |
--
-- 見つかった問題は quality_issues に追加・更新し、見つからなくなった問題は resolved にする。
-- 人が ignored にした問題は、再び見つかっても ignored のまま残す。
create function app.run_quality_checks() returns table (check_key text, open_count bigint)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  drop table if exists pg_temp.qc_found;
  create temporary table qc_found (
    check_key text, target_type text, target_id uuid, severity text, detail jsonb
  ) on commit drop;

  insert into pg_temp.qc_found
  select 'asset_without_post', 'asset', a.id, 'warning', '{}'::jsonb
  from public.assets a
  where a.post_id is null;

  insert into pg_temp.qc_found
  select 'stored_without_file', 'asset', a.id, 'error', '{}'::jsonb
  from public.assets a
  where a.file_policy = 'stored' and a.media_type <> 'text'
    and not exists (select 1 from public.asset_files f where f.asset_id = a.id and f.variant = 'original');

  insert into pg_temp.qc_found
  select 'file_unverified', 'asset_file', f.id, 'warning',
    jsonb_build_object('verified_at', f.verified_at)
  from public.asset_files f
  where f.variant = 'original'
    and (f.verified_at is null or f.verified_at < now() - interval '90 days');

  insert into pg_temp.qc_found
  select 'asset_unlinked', 'asset', a.id, 'warning', '{}'::jsonb
  from public.assets a
  where not exists (
      select 1 from public.links l
      where l.review_state = 'accepted'
        and ((l.from_type = 'asset' and l.from_id = a.id)
          or (l.from_type = 'post' and l.from_id = a.post_id)))
    and not exists (select 1 from public.statements s where s.evidence_asset_id = a.id);

  insert into pg_temp.qc_found
  select 'statement_without_evidence', 'statement', s.id, 'warning', '{}'::jsonb
  from public.statements s
  where s.review_state = 'accepted' and s.evidence_asset_id is null;

  insert into pg_temp.qc_found
  select 'overdue_announcement', 'event', e.id, 'warning',
    jsonb_build_object('starts_on', e.starts_on)
  from public.events e
  where coalesce(e.ends_on, e.starts_on) < today
    and exists (select 1 from public.event_participants p where p.event_id = e.id and p.status = 'scheduled');

  insert into pg_temp.qc_found
  select 'entity_unused', 'entity', e.id, 'info', '{}'::jsonb
  from public.entities e
  where e.merged_into is null
    and not exists (select 1 from public.links l where l.to_type = 'entity' and l.to_id = e.id)
    and not exists (select 1 from public.event_participants p where p.entity_id = e.id)
    and not exists (select 1 from public.statements s
                    where e.id in (s.subject_id, s.value_entity_id, s.speaker_entity_id))
    and not exists (select 1 from public.entity_relations r where e.id in (r.subject_id, r.object_id))
    and not exists (select 1 from public.events ev where e.id in (ev.work_id, ev.venue_id))
    and not exists (select 1 from public.event_items i where i.work_id = e.id)
    and not exists (select 1 from public.channels c where c.owner_entity_id = e.id);

  -- 見つかった問題を追加・更新する（直った後に再発したものは開き直す）
  insert into public.quality_issues as q (check_key, target_type, target_id, severity, detail, classification)
  select f.check_key, f.target_type, f.target_id, f.severity, f.detail, 'internal' from pg_temp.qc_found f
  on conflict (check_key, target_type, target_id) do update
    set last_seen_at = now(),
        severity = excluded.severity,
        detail = excluded.detail,
        state = case when q.state = 'ignored' then 'ignored' else 'open' end,
        resolved_at = case when q.state = 'ignored' then q.resolved_at end;

  -- 見つからなくなった問題を直ったことにする
  update public.quality_issues q
  set state = 'resolved', resolved_at = now()
  where q.state = 'open'
    and not exists (
      select 1 from pg_temp.qc_found f
      where f.check_key = q.check_key and f.target_type = q.target_type and f.target_id = q.target_id);

  return query
  select q.check_key, count(*) from public.quality_issues q
  where q.state = 'open' group by q.check_key order by q.check_key;
end;
$$;

revoke all on function app.run_quality_checks() from public;

-- ---------------------------------------------------------------------------
-- 守りの設定
-- ---------------------------------------------------------------------------

select app.protect_table(t::regclass)
from unnest(array[
  'public.notes', 'public.articles', 'public.article_refs',
  'public.coverage_lenses', 'public.coverage_scopes', 'public.coverage_checks', 'public.coverage_candidates',
  'public.merge_candidates', 'public.jobs', 'public.job_runs', 'public.quality_issues'
]) as t;

grant usage on schema app to aletheia_backup;
