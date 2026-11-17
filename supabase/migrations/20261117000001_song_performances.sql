-- 曲ごとの参加（設計書 決定記録 0060）
--
-- 披露した曲（event_items の item_type = song の行）ごとに、人物が参加したかを持つ。行が無いものは未確認。
-- 出演（event_participants）とは別の事実で、出演から自動では付けない。

create table public.event_item_participants (
  id uuid primary key default gen_random_uuid(),
  event_item_id uuid not null references public.event_items (id) on delete cascade,
  entity_id uuid not null references public.entities (id),
  status text not null check (status in ('appeared', 'not_appearing')),
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  evidence jsonb,
  review_state public.review_state not null default 'accepted',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classification public.classification not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_item_id, entity_id),
  check (origin <> 'human' or confidence = 1)
);
comment on table public.event_item_participants is
  '披露した曲ごとの参加（appeared 参加 / not_appearing 不参加。行が無ければ未確認。決定記録 0060）';

create index event_item_participants_entity_idx on public.event_item_participants (entity_id);

select app.protect_table('public.event_item_participants');

-- 公開: 曲の行と人物が公開で、承認済みのものだけ
create view public_export.event_item_participants with (security_barrier) as
select p.id, p.event_item_id, p.entity_id, p.status
from public.event_item_participants p
where p.classification = 'public'
  and p.review_state = 'accepted'
  and p.event_item_id in (select id from public_export.event_items)
  and p.entity_id in (select id from public_export.entities);

grant select on public_export.event_item_participants to aletheia_public_export;
