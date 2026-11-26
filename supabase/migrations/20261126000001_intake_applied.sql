-- 承認の取り消し（設計書 決定記録 0075）
--
-- 承認で事実の層に足したもの（投稿・素材・紐付け・言明・同じ画像のまとまり）を、下書きに記録する。
-- 直近に承認したものを取り消すとき、これを使って足したものだけを外す。
-- この列が無い（このマイグレーションより前に承認した）下書きは取り消せない。

alter table public.intake_items
  add column applied jsonb check (applied is null or jsonb_typeof(applied) = 'object');

comment on column public.intake_items.applied is
  '承認で事実の層に足したもの（承認の取り消しに使う。決定記録 0075）';
