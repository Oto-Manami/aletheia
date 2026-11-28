-- 「作品にまとめない」の印（events.attributes.no_work）を付けた出来事を、作品を指していない回・号の検査から外す
-- （設計書 決定記録 0082）。ほかの検査は変えない（20261128000002 の定義のまま）

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
    and app.statement_reproduces_paid_text(s.value_text, s.evidence_asset_id)
union all
  -- 本人（蓄積対象の人物）の出演が付いていない出来事。日程（まとまりの各日）は除く（決定記録 0080）
  select 'subject_participation_missing', 'event', e.id, 'info',
    jsonb_build_object('starts_on', e.starts_on)
  from public.events e
  where not (e.parent_id is not null and e.kind <> 'episode' and exists (
      select 1 from public.events sp
      where sp.id = e.parent_id and sp.kind in ('live', 'meet_greet', 'event')))
    and exists (select 1 from public.entities s
                where s.type = 'person' and s.merged_into is null
                  and s.attributes @> '{"archive_subject": true}')
    and not exists (
      select 1 from public.event_participants p
      join public.entities s on s.id = p.entity_id
      where p.event_id = e.id and s.type = 'person' and s.attributes @> '{"archive_subject": true}')
union all
  -- 作品を指していない番組の回・掲載（号）。「作品にまとめない」の印のものは除く（決定記録 0080・0082）
  select 'episode_without_work', 'event', e.id, 'info',
    jsonb_build_object('kind', e.kind, 'starts_on', e.starts_on)
  from public.events e
  where e.kind in ('episode', 'publication') and e.work_id is null
    and not coalesce(e.attributes @> '{"no_work": true}', false);
