-- 基盤: 拡張機能・スキーマ・型・共通の関数
--
-- 公開区分・日付の精度・出どころなど、すべての表で共通に使う型をここで定める。
-- メンバー名・情報源・語彙はデータとして持ち、このファイルには書かない。

create schema if not exists extensions;
create extension if not exists pgroonga with schema extensions;

-- 内部用（閲覧サイトの API には公開しない）
create schema app;
-- 公開サイト用の書き出し（公開専用ロールだけが読む）
create schema public_export;

revoke all on schema app from public;
revoke all on schema public_export from public;

-- ---------------------------------------------------------------------------
-- 型
-- ---------------------------------------------------------------------------

-- 公開区分。宣言の順に「狭くなる」。比較演算（<=）で見える範囲を判定する
create type public.classification as enum ('public', 'internal', 'confidential', 'restricted');

-- 日付の精度。日付はすべて JST の暦日
create type public.date_precision as enum ('year', 'month', 'day', 'minute', 'second');

-- 情報源の有料・無料
create type public.availability as enum ('free', 'paid', 'mixed');

-- 紐付けの出どころ
create type public.origin as enum ('human', 'rule', 'ai', 'import');

-- 紐付けの確認結果（事実の層には承認済みのものだけが入る。rejected は却下した提案の記録）
create type public.review_state as enum ('accepted', 'rejected');

-- 取り込みの下書きの状態
create type public.intake_state as enum ('pending', 'approved', 'rejected', 'on_hold');

create type public.entity_type as enum ('person', 'group', 'work', 'organization', 'place', 'product');

create type public.media_type as enum ('image', 'video', 'audio', 'text', 'webpage', 'document');

create type public.app_role as enum ('admin', 'viewer');

-- ---------------------------------------------------------------------------
-- 共通の関数
-- ---------------------------------------------------------------------------

-- 語彙のキー（snake_case）の形式
create function app.is_key(value text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select value ~ '^[a-z][a-z0-9_]*$'
$$;

-- 名前の正規化（NFKC・小文字・空白の除去）。重複の検出に使う
create function app.normalize_name(value text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(normalize(value, NFKC), '\s+', '', 'g'))
$$;

-- 本文の正規化（置換記号の除去・NFKC・空白の圧縮）。検索に使う
create function app.normalize_text(value text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    normalize(regexp_replace(value, '\{\{[^}]*\}\}', ' ', 'g'), NFKC),
    '\s+', ' ', 'g'))
$$;

-- updated_at を更新する
create function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
