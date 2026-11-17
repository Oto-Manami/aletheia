-- 楽曲リスト（設計書 決定記録 0059）
--
-- 同じ名前の楽曲とシングル（表題曲とシングル名など）を別々に持てるよう、名前の重複を種類（subtype）ごとに判定する。

alter table public.entities drop constraint entities_type_normalized_name_key;

create unique index entities_type_subtype_name_key
  on public.entities (type, coalesce(subtype, ''), normalized_name);
comment on index public.entities_type_subtype_name_key is
  '同じ種類・同じ細かい種類で、同じ名前（正規化したもの）は 1 つだけ（決定記録 0059）';
