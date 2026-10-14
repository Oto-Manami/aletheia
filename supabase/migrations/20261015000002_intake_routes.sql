-- 取り込みの経路と、情報源の種類の追加
--
-- 同じ投稿が別の経路（定期取得・Discord・初回の移行・他のアーカイブ）から届くことがある。
-- 出典（channel_id / external_id）は元の投稿のまま、経路ごとに下書きを 1 件ずつ持つ。
-- 2 件目以降の承認は、既にある投稿への補完になる（承認の処理が行う）。

alter table public.intake_items
  add column route text not null default 'migration'
    check (route ~ '^(fetch|discord|migration|archive:[a-z0-9_-]+)$'),
  add column route_ref text;

-- 経路は必ず指定する（既定値は列を足すときだけ使う）
alter table public.intake_items alter column route drop default;

comment on column public.intake_items.route is
  '取り込みの経路。fetch（定期取得）/ discord（入口チャンネル）/ migration（初回の移行）/ archive:<名前>（他のアーカイブ）';
comment on column public.intake_items.route_ref is '経路の側での ID（Discord のメッセージ ID、他のアーカイブの ID など）';

alter table public.intake_items drop constraint intake_items_channel_id_external_id_key;
alter table public.intake_items
  add constraint intake_items_channel_external_route_key unique (channel_id, external_id, route);

-- ゲーム・ファンクラブの中のコンテンツ
alter table public.channels drop constraint channels_kind_check;
alter table public.channels add constraint channels_kind_check check (
  kind in ('blog', 'message', 'sns', 'video', 'broadcast', 'radio', 'print', 'web', 'game', 'fanclub', 'other')
);
