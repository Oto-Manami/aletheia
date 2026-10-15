-- 公開区分を公開・非公開の 2 段階にし、有料の情報源は「原文を再現させない」で守る
--（設計書 oto-manami-project の決定記録 0009）
--
-- | 公開区分 | 意味                     | 見られる人                         |
-- |----------|--------------------------|------------------------------------|
-- | public   | 公開サイトに出してよい   | 誰でも                             |
-- | private  | 公開サイトに出さない     | 運営者と、閲覧サイトに招待した人   |
--
-- 有料の情報源（availability = paid）:
--   - 素材そのもの（投稿・本文・画像・動画）は、公開区分にかかわらず公開サイトに出さない
--   - 読み取った言明は public なら出してよい。出典は情報源と日付だけを示す
--   - 言明の値に、有料の原文と連続 20 文字以上一致する部分があれば出さない

-- ---------------------------------------------------------------------------
-- 古い公開区分に依存するものを外す
-- ---------------------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in select schemaname, tablename from pg_policies where policyname = 'read_within_clearance' loop
    execute format('drop policy read_within_clearance on %I.%I', p.schemaname, p.tablename);
  end loop;
end;
$$;

drop view public_export.links, public_export.terms, public_export.vocabularies, public_export.statements,
  public_export.entity_relations, public_export.event_items, public_export.event_participants,
  public_export.events, public_export.asset_texts, public_export.assets, public_export.posts,
  public_export.channels, public_export.entities;

drop function app.current_clearance();

-- 招待した人は非公開を含めてすべて見られるため、人ごとの上限は使わない
alter table app.user_profiles drop column clearance;

-- ---------------------------------------------------------------------------
-- 公開区分の型を作り直す
-- ---------------------------------------------------------------------------

create type public.classification_v2 as enum ('public', 'private');

do $$
declare
  col record;
begin
  for col in
    select n.nspname, c.relname, a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.atttypid = 'public.classification'::regtype and c.relkind = 'r' and not a.attisdropped
  loop
    execute format('alter table %I.%I alter column %I drop default', col.nspname, col.relname, col.attname);
    execute format(
      'alter table %I.%I alter column %I type public.classification_v2 using '
      '(case when %I::text = ''public'' then ''public'' else ''private'' end)::public.classification_v2',
      col.nspname, col.relname, col.attname, col.attname);
    execute format('alter table %I.%I alter column %I set default ''private''', col.nspname, col.relname, col.attname);
  end loop;
end;
$$;

drop type public.classification;
alter type public.classification_v2 rename to classification;

-- ---------------------------------------------------------------------------
-- 閲覧サイト: 登録した利用者はすべて読める（書き込みは管理者が API から行う）
-- ---------------------------------------------------------------------------

create function app.is_member() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from app.user_profiles p where p.user_id = auth.uid())
$$;

revoke all on function app.is_member() from public;
grant execute on function app.is_member() to authenticated;

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
  loop
    execute format('create policy read_members on %s for select to authenticated using (app.is_member())', t);
  end loop;
end;
$$;

-- これから作る表にも同じ設定を付ける
create or replace function app.protect_table(t regclass) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('create policy read_members on %s for select to authenticated using (app.is_member())', t);
  execute format('create policy backup_read_all on %s for select to aletheia_backup using (true)', t);
  execute format('grant select on %s to authenticated, aletheia_backup', t);
  execute format(
    'create trigger touch_updated_at before update on %s for each row execute function app.touch_updated_at()', t);
  execute format(
    'create trigger record_history after update or delete on %s for each row execute function app.record_history()', t);
end;
$$;

-- ---------------------------------------------------------------------------
-- 有料の原文の再現の検出
-- ---------------------------------------------------------------------------

-- value の中に、source と連続 min_length 文字以上一致する部分があるか（空白・全角半角の違いは無視する）
create function app.reproduces_text(value text, source text, min_length integer default 20)
returns boolean
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v text := regexp_replace(app.normalize_text(coalesce(value, '')), '\s', '', 'g');
  s text := regexp_replace(app.normalize_text(coalesce(source, '')), '\s', '', 'g');
  i integer;
begin
  if length(v) < min_length or length(s) < min_length then
    return false;
  end if;
  for i in 1 .. length(v) - min_length + 1 loop
    if strpos(s, substr(v, i, min_length)) > 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function app.reproduces_text(text, text, integer) from public;

-- 有料の情報源の素材か（投稿の値が無ければ情報源の既定値。投稿に属さない素材は有料とみなす）
create function app.is_paid_asset(asset uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (select coalesce(p.availability, c.availability) <> 'free'
     from public.assets a
     join public.posts p on p.id = a.post_id
     join public.channels c on c.id = p.channel_id
     where a.id = asset),
    true)
$$;

revoke all on function app.is_paid_asset(uuid) from public;

-- 言明の値が、根拠の有料の原文を再現しているか。
-- 公開用のビューの条件に使うため、公開用ロールにも実行を許す（返すのは真偽だけ）。
-- 中で読む原文は公開用ロールには見えないため、所有者の権限で動かす
create function app.statement_reproduces_paid_text(value_text text, evidence_asset uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select evidence_asset is not null
    and app.is_paid_asset(evidence_asset)
    and exists (
      select 1 from public.asset_texts t
      where t.asset_id = evidence_asset and app.reproduces_text(value_text, t.content)
    )
$$;

revoke all on function app.statement_reproduces_paid_text(text, uuid) from public;
grant execute on function app.statement_reproduces_paid_text(text, uuid) to aletheia_public_export;
grant usage on schema app to aletheia_public_export;

-- ---------------------------------------------------------------------------
-- 公開サイト用のビュー
--
-- 条件: 公開区分が public かつ 承認済み。有料の素材そのものは出さない。
-- 参照先が見えない行は出さない。任意の参照は、参照先が見えなければ null にする。
-- ---------------------------------------------------------------------------

create view public_export.entities with (security_barrier) as
select e.id, e.type, e.subtype, e.canonical_name, e.reading, e.aliases, e.attributes
from public.entities e
where e.classification = 'public' and e.merged_into is null;

-- 情報源は、有料のものも出典の表示のために出す（中身は出さない）
create view public_export.channels with (security_barrier) as
select c.id, c.key, c.name, c.kind,
  case when c.owner_entity_id in (select id from public_export.entities) then c.owner_entity_id end as owner_entity_id
from public.channels c
where c.classification = 'public';

-- 有料の素材そのものは出さない
create view public_export.posts with (security_barrier) as
select p.id, p.channel_id, p.external_id, p.title, p.published_at, p.published_date,
  p.published_date_precision, p.url, p.archived_url, p.content_group_id
from public.posts p
join public.channels c on c.id = p.channel_id
where p.classification = 'public'
  and c.classification = 'public'
  and coalesce(p.availability, c.availability) = 'free';

create view public_export.assets with (security_barrier) as
select a.id, a.post_id, a.position, a.media_type, a.title, a.description, a.content_date,
  a.content_date_precision, a.content_at, a.content_group_id, a.mime_type, a.duration_ms,
  a.width, a.height
from public.assets a
where a.classification = 'public'
  and a.post_id in (select id from public_export.posts);

create view public_export.asset_texts with (security_barrier) as
select t.id, t.asset_id, t.text_type, t.content
from public.asset_texts t
where t.classification = 'public'
  and t.asset_id in (select id from public_export.assets);

create view public_export.events with (security_barrier) as
select ev.id,
  case when ev.parent_id in (select id from public.events where classification = 'public') then ev.parent_id end as parent_id,
  ev.kind, ev.title,
  case when ev.work_id in (select id from public_export.entities) then ev.work_id end as work_id,
  ev.episode_number, ev.starts_on, ev.ends_on, ev.date_precision, ev.starts_at, ev.ends_at,
  case when ev.venue_id in (select id from public_export.entities) then ev.venue_id end as venue_id,
  ev.attributes
from public.events ev
where ev.classification = 'public';

create view public_export.event_participants with (security_barrier) as
select p.id, p.event_id, p.entity_id, p.role, p.character_name, p.status, p.attributes
from public.event_participants p
where p.classification = 'public'
  and p.review_state = 'accepted'
  and p.event_id in (select id from public_export.events)
  and p.entity_id in (select id from public_export.entities);

create view public_export.event_items with (security_barrier) as
select i.id, i.event_id, i.position, i.item_type,
  case when i.work_id in (select id from public_export.entities) then i.work_id end as work_id,
  i.title, i.attributes
from public.event_items i
where i.classification = 'public'
  and i.event_id in (select id from public_export.events)
  and (i.title is not null or i.work_id in (select id from public_export.entities));

create view public_export.entity_relations with (security_barrier) as
select r.id, r.subject_id, r.object_id, r.relation, r.position, r.valid_from,
  r.valid_from_precision, r.valid_to, r.valid_to_precision, r.attributes
from public.entity_relations r
where r.classification = 'public'
  and r.review_state = 'accepted'
  and r.subject_id in (select id from public_export.entities)
  and r.object_id in (select id from public_export.entities);

-- 言明は、根拠が有料の素材でも出す。ただし根拠の素材は指さず、出典として情報源と日付だけを示す。
-- 有料の原文を再現している値は出さない
create view public_export.statements with (security_barrier) as
select s.id, s.subject_id, s.property, s.value_text, s.value_entity_id, s.value_date,
  s.value_date_precision, s.stated_on, s.stated_on_precision, s.valid_from, s.valid_to,
  s.speaker_type, s.speaker_entity_id,
  case when ev.exported then s.evidence_asset_id end as evidence_asset_id,
  case when ev.exported then s.excerpt_start end as excerpt_start,
  case when ev.exported then s.excerpt_end end as excerpt_end,
  case when ev.channel_id in (select id from public_export.channels) then ev.channel_id end as source_channel_id,
  ev.published_date as source_date,
  ev.published_date_precision as source_date_precision
from public.statements s
left join lateral (
  select a.id in (select id from public_export.assets) as exported,
    p.channel_id, p.published_date, p.published_date_precision
  from public.assets a
  left join public.posts p on p.id = a.post_id
  where a.id = s.evidence_asset_id
) ev on true
where s.classification = 'public'
  and s.review_state = 'accepted'
  and s.subject_id in (select id from public_export.entities)
  and (s.value_entity_id is null or s.value_entity_id in (select id from public_export.entities))
  and (s.speaker_entity_id is null or s.speaker_entity_id in (select id from public_export.entities))
  and not app.statement_reproduces_paid_text(s.value_text, s.evidence_asset_id);

create view public_export.vocabularies with (security_barrier) as
select v.id, v.key, v.name, v.applies_to
from public.vocabularies v
where v.classification = 'public';

create view public_export.terms with (security_barrier) as
select t.id, t.vocabulary_id,
  case when t.parent_id in (select id from public.terms where classification = 'public') then t.parent_id end as parent_id,
  t.name, t.aliases
from public.terms t
where t.classification = 'public'
  and t.vocabulary_id in (select id from public_export.vocabularies);

create view public_export.links with (security_barrier) as
select l.id, l.from_type, l.from_id, l.to_type, l.to_id, l.role
from public.links l
where l.classification = 'public'
  and l.review_state = 'accepted'
  and (
    (l.from_type = 'post' and l.from_id in (select id from public_export.posts))
    or (l.from_type = 'asset' and l.from_id in (select id from public_export.assets))
  )
  and (
    (l.to_type = 'entity' and l.to_id in (select id from public_export.entities))
    or (l.to_type = 'event' and l.to_id in (select id from public_export.events))
    or (l.to_type = 'term' and l.to_id in (select id from public_export.terms))
  );

grant select on all tables in schema public_export to aletheia_public_export;

-- ---------------------------------------------------------------------------
-- データ品質の検査に「有料の原文の再現」を加える
-- ---------------------------------------------------------------------------

-- | paid_text_reproduced | error | 公開の言明の値が、根拠の有料の原文と連続 20 文字以上一致する |
-- 公開用の書き出しからは自動で外れるが、値を言い換えるべきことを知らせる
create or replace view app.quality_findings with (security_invoker) as
  select 'asset_without_post'::text as check_key, 'asset'::text as target_type, a.id as target_id,
    'warning'::text as severity, '{}'::jsonb as detail
  from public.assets a
  where a.post_id is null
union all
  select 'stored_without_file', 'asset', a.id, 'error', '{}'::jsonb
  from public.assets a
  where a.file_policy = 'stored' and a.media_type <> 'text'
    and not exists (select 1 from public.asset_files f where f.asset_id = a.id and f.variant = 'original')
union all
  select 'file_unverified', 'asset_file', f.id, 'warning',
    jsonb_build_object('verified_at', f.verified_at)
  from public.asset_files f
  where f.variant = 'original'
    and (f.verified_at is null or f.verified_at < now() - interval '90 days')
union all
  select 'asset_unlinked', 'asset', a.id, 'warning', '{}'::jsonb
  from public.assets a
  where not exists (
      select 1 from public.links l
      where l.review_state = 'accepted'
        and ((l.from_type = 'asset' and l.from_id = a.id)
          or (l.from_type = 'post' and l.from_id = a.post_id)))
    and not exists (select 1 from public.statements s where s.evidence_asset_id = a.id)
union all
  select 'statement_without_evidence', 'statement', s.id, 'warning', '{}'::jsonb
  from public.statements s
  where s.review_state = 'accepted' and s.evidence_asset_id is null
union all
  select 'overdue_announcement', 'event', e.id, 'warning',
    jsonb_build_object('starts_on', e.starts_on)
  from public.events e
  where coalesce(e.ends_on, e.starts_on) < (now() at time zone 'Asia/Tokyo')::date
    and exists (select 1 from public.event_participants p where p.event_id = e.id and p.status = 'scheduled')
union all
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
    and not exists (select 1 from public.channels c where c.owner_entity_id = e.id)
union all
  select 'paid_text_reproduced', 'statement', s.id, 'error',
    jsonb_build_object('evidence_asset_id', s.evidence_asset_id)
  from public.statements s
  where s.classification = 'public'
    and app.statement_reproduces_paid_text(s.value_text, s.evidence_asset_id);

-- 見つけた問題の公開区分を、新しい区分（private）で記録する
create or replace function app.run_quality_checks() returns table (check_key text, open_count bigint)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- 見つかった問題を追加・更新し（直った後に再発したものは開き直す）、
  -- 見つからなくなった問題を直ったことにする。両者は対象の行が重ならない
  with found as (
    select * from app.quality_findings
  ),
  upserted as (
    insert into public.quality_issues as q (check_key, target_type, target_id, severity, detail, classification)
    select f.check_key, f.target_type, f.target_id, f.severity, f.detail, 'private' from found f
    on conflict (check_key, target_type, target_id) do update
      set last_seen_at = now(),
          severity = excluded.severity,
          detail = excluded.detail,
          state = case when q.state = 'ignored' then 'ignored' else 'open' end,
          resolved_at = case when q.state = 'ignored' then q.resolved_at end
    returning 1
  )
  update public.quality_issues q
  set state = 'resolved', resolved_at = now()
  where q.state = 'open'
    and not exists (
      select 1 from found f
      where f.check_key = q.check_key and f.target_type = q.target_type and f.target_id = q.target_id);

  return query
  select q.check_key, count(*) from public.quality_issues q
  where q.state = 'open' group by q.check_key order by q.check_key;
end;
$$;

revoke all on function app.run_quality_checks() from public;
