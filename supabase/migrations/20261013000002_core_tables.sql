-- 中核の表（データモデル v2）
--
-- すべての表が持つ列:
--   id             uuid
--   classification 公開区分。既定は最も狭い restricted（設定し忘れても公開されない）
--   created_at / updated_at
--
-- 紐付け・関係・出演・言明は「出どころ列」を持つ:
--   origin / confidence / evidence / review_state / created_by / reviewed_by / reviewed_at

-- ---------------------------------------------------------------------------
-- エンティティ（人物・グループ・作品・組織・場所・物）
-- ---------------------------------------------------------------------------

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  type public.entity_type not null,
  subtype text check (subtype is null or app.is_key(subtype)),
  canonical_name text not null check (btrim(canonical_name) <> ''),
  normalized_name text generated always as (app.normalize_name(canonical_name)) stored,
  reading text,
  aliases text[] not null default '{}',
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  merged_into uuid references public.entities (id),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, normalized_name),
  check (merged_into is null or merged_into <> id)
);
comment on table public.entities is '人物・グループ・作品・組織・場所・物。統合したものは消さずに merged_into で転送先を示す';

create table public.entity_identifiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id),
  scheme text not null check (app.is_key(scheme)),
  value text not null check (btrim(value) <> ''),
  valid_from date,
  valid_to date,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scheme, value),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
comment on table public.entity_identifiers is 'SNS アカウント・公式プロフィールなど、エンティティにぶら下がる外部の識別子';

create table public.entity_relations (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.entities (id),
  object_id uuid not null references public.entities (id),
  relation text not null check (app.is_key(relation)),
  position integer,
  valid_from date,
  valid_from_precision public.date_precision,
  valid_to date,
  valid_to_precision public.date_precision,
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  evidence jsonb,
  review_state public.review_state not null default 'accepted',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_id <> object_id),
  check (origin <> 'human' or confidence = 1),
  check (valid_from is null or valid_from_precision is not null),
  check (valid_to is null or valid_to_precision is not null),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
comment on table public.entity_relations is '所属・収録・シリーズなど、エンティティ同士の関係（期間つき）';

-- ---------------------------------------------------------------------------
-- 情報源と素材
-- ---------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*(:\S+)?$'),
  name text not null,
  kind text not null check (kind in ('blog', 'message', 'sns', 'video', 'broadcast', 'radio', 'print', 'web', 'other')),
  owner_entity_id uuid references public.entities (id),
  -- 既定は有料扱い（設定し忘れても公開サイトに出ない）
  availability public.availability not null default 'paid',
  item_unit text not null check (item_unit in ('post', 'day', 'episode', 'issue')),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.channels is '情報源のマスタ。情報がどこから来るかを種類ごとに 1 行で定義する';

create table public.content_groups (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('cross_post', 'live_archive', 'repost')),
  representative_asset_id uuid,
  note text,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.content_groups is '別々の投稿・素材に載っている同じ内容のまとまり。代表のアセットだけがファイルを保存する';

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id),
  external_id text not null check (btrim(external_id) <> ''),
  title text,
  published_at timestamptz,
  published_date date,
  published_date_precision public.date_precision,
  url text,
  archived_url text,
  archived_at timestamptz,
  captured_at timestamptz,
  -- 情報源の既定値を上書きする場合のみ
  availability public.availability,
  content_group_id uuid references public.content_groups (id),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, external_id),
  check (published_date is null or published_date_precision is not null)
);
comment on table public.posts is '投稿・回・号など、一緒に存在していた素材のまとまり。同じものは何度取り込んでも 1 行';

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id),
  position integer,
  media_type public.media_type not null,
  title text,
  description text,
  content_date date,
  content_date_precision public.date_precision,
  content_at timestamptz,
  status text not null default 'organized' check (status in ('organized', 'archived')),
  file_policy text not null default 'stored' check (file_policy in ('stored', 'reference_only')),
  content_group_id uuid references public.content_groups (id),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  phash text,
  mime_type text,
  byte_size bigint check (byte_size >= 0),
  duration_ms integer check (duration_ms >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  original_filename text,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (content_date is null or content_date_precision is not null),
  check (post_id is null or position is not null)
);
comment on table public.assets is '素材の基本単位（画像・動画・音声・テキスト・Web ページ・文書）';

create unique index assets_post_position_key on public.assets (post_id, position) where post_id is not null;
-- 完全に同じファイルは 1 つだけ保存する
create unique index assets_stored_sha256_key on public.assets (sha256) where file_policy = 'stored' and sha256 is not null;
create index assets_content_group_idx on public.assets (content_group_id);

alter table public.content_groups
  add constraint content_groups_representative_asset_fkey
  foreign key (representative_asset_id) references public.assets (id);

create table public.asset_texts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id),
  text_type text not null check (text_type in ('body', 'caption', 'ocr', 'transcript', 'alt')),
  content text not null,
  normalized_content text generated always as (app.normalize_text(content)) stored,
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin <> 'human' or confidence = 1)
);
comment on table public.asset_texts is '素材のテキスト（本文・キャプション・OCR・書き起こし）。検索の主な対象';

create index asset_texts_asset_idx on public.asset_texts (asset_id);

create table public.asset_files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id),
  variant text not null check (variant in ('original', 'thumbnail', 'preview', 'transcoded')),
  provider text not null check (app.is_key(provider)),
  storage_key text not null,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check (byte_size >= 0),
  verified_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, storage_key)
);
comment on table public.asset_files is 'ファイル実体の所在。1 つのアセットが複数の保存先・派生ファイルを持てる';

create index asset_files_asset_idx on public.asset_files (asset_id);

-- ---------------------------------------------------------------------------
-- 出来事（日付を持つ活動）
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.events (id),
  kind text not null check (app.is_key(kind)),
  title text,
  work_id uuid references public.entities (id),
  episode_number integer,
  starts_on date,
  ends_on date,
  date_precision public.date_precision,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_id uuid references public.entities (id),
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  check (starts_on is null or date_precision is not null),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
comment on table public.events is '日付を持つ活動（公演・放送回・発売・掲載・イベントなど）';

create index events_parent_idx on public.events (parent_id);
create index events_starts_on_idx on public.events (starts_on);

create table public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  entity_id uuid not null references public.entities (id),
  role text not null check (app.is_key(role)),
  character_name text,
  status text not null check (status in ('scheduled', 'appeared', 'absent', 'cancelled')),
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  evidence jsonb,
  review_state public.review_state not null default 'accepted',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, entity_id, role),
  check (origin <> 'human' or confidence = 1)
);
comment on table public.event_participants is '出来事への出演・参加（代役は attributes.substitute_for）';

create index event_participants_entity_idx on public.event_participants (entity_id);

create table public.event_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  position integer not null,
  item_type text not null check (app.is_key(item_type)),
  work_id uuid references public.entities (id),
  title text,
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, position),
  check (work_id is not null or title is not null)
);
comment on table public.event_items is 'セットリスト・企画・掲載ページなど、出来事の中身の並び';

-- ---------------------------------------------------------------------------
-- ステートメント（人物についての言明）
-- ---------------------------------------------------------------------------

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.entities (id),
  property text not null check (app.is_key(property)),
  value_text text,
  value_entity_id uuid references public.entities (id),
  value_date date,
  value_date_precision public.date_precision,
  stated_on date,
  stated_on_precision public.date_precision,
  valid_from date,
  valid_to date,
  speaker_type text not null check (speaker_type in ('self', 'official', 'third_party')),
  -- 誰が言ったか（メンバーからの言及では言及したメンバー）
  speaker_entity_id uuid references public.entities (id),
  evidence_asset_id uuid references public.assets (id),
  excerpt_start integer check (excerpt_start >= 0),
  excerpt_end integer,
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  evidence jsonb,
  review_state public.review_state not null default 'accepted',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(value_text, value_entity_id, value_date) >= 1),
  check (value_date is null or value_date_precision is not null),
  check (stated_on is null or stated_on_precision is not null),
  check (excerpt_end is null or (excerpt_start is not null and excerpt_end >= excerpt_start)),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (origin <> 'human' or confidence = 1)
);
comment on table public.statements is '人物についての言明。誰がいつどこでそう言ったかまでを事実として持つ';

create index statements_subject_idx on public.statements (subject_id, property);
create index statements_speaker_idx on public.statements (speaker_entity_id);

-- ---------------------------------------------------------------------------
-- 語彙（ファセット）
-- ---------------------------------------------------------------------------

create table public.vocabularies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (app.is_key(key)),
  name text not null,
  applies_to text[] not null default '{}',
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.vocabularies is '分類の軸（ファセット）の定義';

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  vocabulary_id uuid not null references public.vocabularies (id),
  parent_id uuid references public.terms (id),
  name text not null check (btrim(name) <> ''),
  aliases text[] not null default '{}',
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vocabulary_id, name),
  check (parent_id is null or parent_id <> id)
);
comment on table public.terms is '軸の中の語。親子の階層を持てる';

-- ---------------------------------------------------------------------------
-- 紐付け（素材 → 人物・出来事・語彙）
-- ---------------------------------------------------------------------------

create table public.links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null check (from_type in ('post', 'asset')),
  from_id uuid not null,
  to_type text not null check (to_type in ('entity', 'event', 'term')),
  to_id uuid not null,
  role text not null check (app.is_key(role)),
  origin public.origin not null default 'human',
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  evidence jsonb,
  review_state public.review_state not null default 'accepted',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, role),
  check (origin <> 'human' or confidence = 1)
);
comment on table public.links is '素材と人物・出来事・語彙の紐付け。役割と出どころつき';

create index links_to_idx on public.links (to_type, to_id, role);

-- 紐付けの両端が実在することを確かめる（参照先が種類ごとに異なるため外部キーの代わりに使う）
create function app.check_link_endpoints() returns trigger
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

create trigger links_check_endpoints
  before insert or update of from_type, from_id, to_type, to_id on public.links
  for each row execute function app.check_link_endpoints();

-- 紐付けの参照先を消すときは、先に紐付けを外す
create function app.prevent_orphan_links() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kind text := tg_argv[0];
begin
  if exists (
    select 1 from public.links
    where (kind in ('post', 'asset') and from_type = kind and from_id = old.id)
       or (kind in ('entity', 'event', 'term') and to_type = kind and to_id = old.id)
  ) then
    raise exception 'links から参照されている % % は削除できません', kind, old.id
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

create trigger posts_prevent_orphan_links before delete on public.posts
  for each row execute function app.prevent_orphan_links('post');
create trigger assets_prevent_orphan_links before delete on public.assets
  for each row execute function app.prevent_orphan_links('asset');
create trigger entities_prevent_orphan_links before delete on public.entities
  for each row execute function app.prevent_orphan_links('entity');
create trigger events_prevent_orphan_links before delete on public.events
  for each row execute function app.prevent_orphan_links('event');
create trigger terms_prevent_orphan_links before delete on public.terms
  for each row execute function app.prevent_orphan_links('term');

-- ---------------------------------------------------------------------------
-- 取り込みの下書き（承認制）
-- ---------------------------------------------------------------------------

create table public.intake_items (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id),
  external_id text not null check (btrim(external_id) <> ''),
  captured_at timestamptz not null,
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  staged_files jsonb not null default '[]' check (jsonb_typeof(staged_files) = 'array'),
  state public.intake_state not null default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  classification public.classification not null default 'restricted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, external_id),
  check (state not in ('approved', 'rejected') or reviewed_at is not null)
);
comment on table public.intake_items is '取り込みの下書き。人が承認したものだけが事実の層に反映される';

create index intake_items_pending_idx on public.intake_items (captured_at) where state = 'pending';

-- ---------------------------------------------------------------------------
-- 利用者
-- ---------------------------------------------------------------------------

create table app.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'viewer',
  -- 見える公開区分の上限。既定は internal
  clearance public.classification not null default 'internal',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'admin' or clearance = 'restricted')
);
comment on table app.user_profiles is '閲覧サイトの利用者と、見える公開区分の上限';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

do $$
declare
  t regclass;
begin
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'app' and c.relname = 'user_profiles'))
  loop
    execute format(
      'create trigger touch_updated_at before update on %s for each row execute function app.touch_updated_at()',
      t);
  end loop;
end;
$$;
