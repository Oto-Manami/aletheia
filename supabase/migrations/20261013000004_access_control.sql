-- 権限と公開区分
--
-- 使う側ごとに、見える範囲を DB の仕組みで固定する。
--
-- | 使う側                     | ロール                  | 見える範囲                                        |
-- |----------------------------|-------------------------|---------------------------------------------------|
-- | 閲覧サイト（未ログイン）   | anon                    | なし                                              |
-- | 閲覧サイト（ログイン）     | authenticated           | 利用者ごとの公開区分の上限まで。読み取りのみ      |
-- | ファンサイト用の書き出し   | aletheia_public_export  | public_export スキーマのビューのみ                |
-- | バックアップ               | aletheia_backup         | すべての行（読み取りのみ）                        |
--
-- 公開区分が設定されていない行・利用者の登録がない人には、何も見えない（fail-closed）。

-- ---------------------------------------------------------------------------
-- 利用者の公開区分
-- ---------------------------------------------------------------------------

-- ログインしている利用者が見てよい公開区分の上限。登録がなければ null（何も見えない）
create function app.current_clearance() returns public.classification
language sql stable security definer
set search_path = ''
as $$
  select p.clearance from app.user_profiles p where p.user_id = auth.uid()
$$;

create function app.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from app.user_profiles p where p.user_id = auth.uid()), false)
$$;

revoke all on all functions in schema app from public;
grant usage on schema app to authenticated;
grant execute on function app.current_clearance() to authenticated;
grant execute on function app.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- DB ロール（パスワードはマイグレーションに書かない。ログインの有効化は運用手順で行う）
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aletheia_public_export') then
    create role aletheia_public_export nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'aletheia_backup') then
    create role aletheia_backup nologin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 表の権限
-- ---------------------------------------------------------------------------

-- 既定の権限を外し、必要なものだけを付け直す
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;
grant select on all tables in schema public to authenticated;

-- これから作る表にも、閲覧サイト経由の書き込み権限を付けない
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon;

-- バックアップ: すべての表を読める
grant usage on schema public, app to aletheia_backup;
grant select on all tables in schema public to aletheia_backup;
grant select on app.history, app.user_profiles to aletheia_backup;

-- 公開用: public_export スキーマだけ
grant usage on schema public_export to aletheia_public_export;

-- ---------------------------------------------------------------------------
-- 行レベルセキュリティ
-- ---------------------------------------------------------------------------

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
  loop
    execute format('alter table %s enable row level security', t);
    execute format(
      'create policy read_within_clearance on %s for select to authenticated '
      'using (classification <= app.current_clearance())', t);
    execute format('create policy backup_read_all on %s for select to aletheia_backup using (true)', t);
  end loop;
end;
$$;

alter table app.user_profiles enable row level security;
create policy read_own_profile on app.user_profiles for select to authenticated
  using (user_id = auth.uid());
create policy backup_read_all on app.user_profiles for select to aletheia_backup using (true);
grant select on app.user_profiles to authenticated;

alter table app.history enable row level security;
create policy backup_read_all on app.history for select to aletheia_backup using (true);

-- ---------------------------------------------------------------------------
-- 公開サイト用のビュー
--
-- 条件: 公開区分が public かつ 有料の情報源でない かつ 紐付けが承認済み（accepted）。
-- 参照先が見えない行は出さない。出来事の会場・作品のように任意の参照は、
-- 参照先が見えなければ null にする。
-- ---------------------------------------------------------------------------

create view public_export.entities with (security_barrier) as
select e.id, e.type, e.subtype, e.canonical_name, e.reading, e.aliases, e.attributes
from public.entities e
where e.classification = 'public' and e.merged_into is null;

create view public_export.channels with (security_barrier) as
select c.id, c.key, c.name, c.kind,
  case when c.owner_entity_id in (select id from public_export.entities) then c.owner_entity_id end as owner_entity_id
from public.channels c
where c.classification = 'public' and c.availability <> 'paid';

create view public_export.posts with (security_barrier) as
select p.id, p.channel_id, p.external_id, p.title, p.published_at, p.published_date,
  p.published_date_precision, p.url, p.archived_url, p.content_group_id
from public.posts p
join public.channels c on c.id = p.channel_id
where p.classification = 'public'
  and c.classification = 'public'
  and coalesce(p.availability, c.availability) = 'free';

-- 投稿に属さない単独の素材は、有料かどうかを判定できないため出さない
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

-- 根拠の素材が公開できない（有料・非公開）言明は出さない
create view public_export.statements with (security_barrier) as
select s.id, s.subject_id, s.property, s.value_text, s.value_entity_id, s.value_date,
  s.value_date_precision, s.stated_on, s.stated_on_precision, s.valid_from, s.valid_to,
  s.speaker_type, s.speaker_entity_id, s.evidence_asset_id, s.excerpt_start, s.excerpt_end
from public.statements s
where s.classification = 'public'
  and s.review_state = 'accepted'
  and s.subject_id in (select id from public_export.entities)
  and (s.value_entity_id is null or s.value_entity_id in (select id from public_export.entities))
  and (s.speaker_entity_id is null or s.speaker_entity_id in (select id from public_export.entities))
  and (s.evidence_asset_id is null or s.evidence_asset_id in (select id from public_export.assets));

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
