-- 閲覧サイトから出来事・作品・相手を作る・直す（設計書 決定記録 0027）
--
-- 作った人・最後に直した人（閲覧サイトの利用者。auth.users の ID）を残す。
-- 直す前の状態は変更履歴（app.history）に、直した人とともに残る。

alter table public.events
  add column created_by uuid,
  add column updated_by uuid;
comment on column public.events.created_by is '閲覧サイトで作った人（auth.users の ID）。取り込み・移行で作ったものは null';
comment on column public.events.updated_by is '閲覧サイトで最後に直した人（auth.users の ID）';

alter table public.entities
  add column created_by uuid,
  add column updated_by uuid;
comment on column public.entities.created_by is '閲覧サイトで作った人（auth.users の ID）。取り込み・移行で作ったものは null';
comment on column public.entities.updated_by is '閲覧サイトで最後に直した人（auth.users の ID）';
