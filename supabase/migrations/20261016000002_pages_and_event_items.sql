-- 複数ページのコンテンツのページ番号と、出来事の中身（記事・企画）への紐付け
--（設計書 oto-manami-project#23）
--
-- 雑誌などは 1 ページ（見開きなら 1 枚）を 1 アセットにし、ページ番号を attributes に持つ。
--   page_from / page_to  写しているページ（見開きなら 2 ページ分）
--   page_label           表紙・裏表紙など、ページ番号の無い面
--   clip_from / clip_to  映像の切り出しの範囲（秒）
-- 素材は、号・回全体だけでなく、その中の記事・コーナー（event_items）にも紐付けられる（役割 part_of）。

-- ---------------------------------------------------------------------------
-- 素材の属性
-- ---------------------------------------------------------------------------

-- 整数として書かれているか（jsonb の値）
create function app.jsonb_is_int(value jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select value is null or (jsonb_typeof(value) = 'number' and value::text ~ '^-?\d+$')
$$;

revoke all on function app.jsonb_is_int(jsonb) from public;

alter table public.assets
  add column attributes jsonb not null default '{}'
    check (jsonb_typeof(attributes) = 'object'),
  -- 型を確かめてから数値として比べる（case で評価の順番を決める）
  add constraint assets_pages_check check (
    case
      when not (app.jsonb_is_int(attributes -> 'page_from') and app.jsonb_is_int(attributes -> 'page_to')) then false
      else coalesce((attributes ->> 'page_from')::numeric, 1) >= 1
        and (
          attributes -> 'page_to' is null
          or (attributes -> 'page_from' is not null
              and (attributes ->> 'page_to')::numeric >= (attributes ->> 'page_from')::numeric)
        )
    end
  ),
  add constraint assets_clip_check check (
    case
      when coalesce(jsonb_typeof(attributes -> 'clip_from'), 'number') <> 'number'
        or coalesce(jsonb_typeof(attributes -> 'clip_to'), 'number') <> 'number' then false
      else coalesce((attributes ->> 'clip_from')::numeric, 0) >= 0
        and (
          attributes -> 'clip_to' is null
          or (attributes -> 'clip_from' is not null
              and (attributes ->> 'clip_to')::numeric > (attributes ->> 'clip_from')::numeric)
        )
    end
  );

comment on column public.assets.attributes is
  '素材の種類ごとの属性。誌面のページ（page_from / page_to / page_label）、映像の切り出し（clip_from / clip_to、秒）';

-- ---------------------------------------------------------------------------
-- 紐付けの行き先に、出来事の中身を加える
-- ---------------------------------------------------------------------------

alter table public.links drop constraint links_to_type_check;
alter table public.links
  add constraint links_to_type_check check (to_type in ('entity', 'event', 'event_item', 'term'));

create or replace function app.check_link_endpoints() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found boolean;
begin
  if new.from_type = 'post' then
    select exists (select 1 from public.posts where id = new.from_id) into found;
  else
    select exists (select 1 from public.assets where id = new.from_id) into found;
  end if;
  if not found then
    raise exception 'links: % % が存在しません', new.from_type, new.from_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.to_type = 'entity' then
    select exists (select 1 from public.entities where id = new.to_id) into found;
  elsif new.to_type = 'event' then
    select exists (select 1 from public.events where id = new.to_id) into found;
  elsif new.to_type = 'event_item' then
    select exists (select 1 from public.event_items where id = new.to_id) into found;
  else
    select exists (select 1 from public.terms where id = new.to_id) into found;
  end if;
  if not found then
    raise exception 'links: % % が存在しません', new.to_type, new.to_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

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
       or (kind in ('entity', 'event', 'event_item', 'term') and to_type = kind and to_id = old.id)
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

create trigger event_items_prevent_orphan_links before delete on public.event_items
  for each row execute function app.prevent_orphan_links('event_item');

-- ---------------------------------------------------------------------------
-- 公開サイト用のビュー
-- ---------------------------------------------------------------------------

-- ページ番号などを出す（列を末尾に足す）
create or replace view public_export.assets with (security_barrier) as
select a.id, a.post_id, a.position, a.media_type, a.title, a.description, a.content_date,
  a.content_date_precision, a.content_at, a.content_group_id, a.mime_type, a.duration_ms,
  a.width, a.height, a.attributes
from public.assets a
where a.classification = 'public'
  and a.post_id in (select id from public_export.posts);

create or replace view public_export.links with (security_barrier) as
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
    or (l.to_type = 'event_item' and l.to_id in (select id from public_export.event_items))
    or (l.to_type = 'term' and l.to_id in (select id from public_export.terms))
  );
