-- 一覧の無い情報源（Web 媒体など）で、どの日付の分まで探したか
--
-- ブログ・メッセージ・番組は情報源の側に全件の一覧があるが、Web 媒体には無い。
-- そのため「どこまで探したか」と「見つけたものを読んだか（coverage_checks）」の 2 段で管理する。

alter table public.channels
  add column searched_through date;

comment on column public.channels.searched_through is
  '一覧の無い情報源で、どの日付（JST）の分まで探したか。一覧のある情報源では null';
