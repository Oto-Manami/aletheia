-- 人物の画面: 言及の向きを引くビューと、言及の根拠の素材を ID で残す（設計書 決定記録 0079）
--
-- - app.evidence_asset_ids: 紐付けの根拠（evidence.matches・evidence.excerpts）の中で、下書きの呼び名
--   （body・a0 など）で指している素材を、投稿の素材の ID に直す。その種類の文字を持つ素材が投稿の中で
--   1 つに決まるときだけ直し、決まらなければそのまま残す
-- - これまでに承認した言及の根拠を直す（承認の処理は、これからは素材の ID で残す）
-- - app.mentions: 言及の紐付け 1 行につき 1 行。誰が（発信者）・誰に・いつ・どの投稿で触れたか

create function app.evidence_asset_ids(p_post uuid, p_evidence jsonb) returns jsonb
language sql
stable
set search_path = ''
as $$
  with fixed as (
    select key, (
      select jsonb_agg(
        case
          when jsonb_typeof(item) <> 'object'
            or coalesce(item ->> 'asset', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then item
          else coalesce(
            item || (
              select jsonb_build_object('asset', min(a.id::text))
              from public.assets a
              where a.post_id = p_post
                and exists (
                  select 1 from public.asset_texts t
                  where t.asset_id = a.id and t.text_type = item ->> 'text_type'
                )
              having count(*) = 1
            ),
            item
          )
        end
        order by n
      )
      from jsonb_array_elements(p_evidence -> key) with ordinality as e(item, n)
    ) as value
    from unnest(array['matches', 'excerpts']) as k(key)
    where jsonb_typeof(p_evidence -> key) = 'array'
  )
  select p_evidence || coalesce(
    (select jsonb_object_agg(key, value) from fixed where value is not null),
    '{}'::jsonb
  )
$$;

comment on function app.evidence_asset_ids(uuid, jsonb) is
  '紐付けの根拠の中で、下書きの呼び名で指している素材を、投稿の素材の ID に直す（決定記録 0079）';

revoke all on function app.evidence_asset_ids(uuid, jsonb) from public;

-- これまでに承認した言及の根拠を直す（変更前の値は変更履歴に残る）
update public.links l
   set evidence = app.evidence_asset_ids(l.from_id, l.evidence)
 where l.from_type = 'post'
   and l.role = 'mentioned'
   and jsonb_typeof(l.evidence) = 'object'
   and ((l.evidence -> 'matches') is not null or (l.evidence -> 'excerpts') is not null)
   and app.evidence_asset_ids(l.from_id, l.evidence) <> l.evidence;

-- 言及の向き。発信者は投稿の author（いちばん先に付いたもの）。無ければ情報源の持ち主
create view app.mentions with (security_invoker) as
select
  l.id as link_id,
  l.to_id as person_id,
  p.id as post_id,
  p.channel_id,
  coalesce(author.entity_id, ch.owner_entity_id) as speaker_id,
  speaker.type as speaker_type,
  p.published_at,
  coalesce((p.published_at at time zone 'Asia/Tokyo')::date, p.published_date) as published_on,
  l.evidence,
  l.origin,
  l.classification,
  l.created_at
from public.links l
join public.posts p on p.id = case
  when l.from_type = 'post' then l.from_id
  else (select a.post_id from public.assets a where a.id = l.from_id)
end
join public.channels ch on ch.id = p.channel_id
left join lateral (
  select au.to_id as entity_id
  from public.links au
  where au.from_type = 'post' and au.from_id = p.id and au.role = 'author'
    and au.to_type = 'entity' and au.review_state = 'accepted'
  order by au.created_at, au.id
  limit 1
) author on true
left join public.entities speaker on speaker.id = coalesce(author.entity_id, ch.owner_entity_id)
where l.role = 'mentioned' and l.to_type = 'entity' and l.review_state = 'accepted';

comment on view app.mentions is
  '言及の向き。言及の紐付け 1 行につき、誰が（発信者）・誰に・いつ・どの投稿で触れたか（決定記録 0079）';

-- API（とデータベースを直接見る運営者）だけが使う。閲覧サイトからは API を通して読む
revoke all on app.mentions from public;
