-- 外部キーの列の索引
--
-- 参照先を削除・統合するときの確認や、人物・作品から関連する行を引くときに使う。
-- 新しく外部キーを足すときは、索引も一緒に作る（structure.test.ts が検査する）。

create index channels_owner_entity_idx on public.channels (owner_entity_id);
create index content_groups_representative_asset_idx on public.content_groups (representative_asset_id);
create index entities_merged_into_idx on public.entities (merged_into);
create index entity_identifiers_entity_idx on public.entity_identifiers (entity_id);
create index entity_relations_subject_idx on public.entity_relations (subject_id, relation);
create index entity_relations_object_idx on public.entity_relations (object_id, relation);
create index event_items_work_idx on public.event_items (work_id);
create index events_venue_idx on public.events (venue_id);
create index events_work_idx on public.events (work_id);
create index posts_content_group_idx on public.posts (content_group_id);
create index statements_evidence_asset_idx on public.statements (evidence_asset_id);
create index statements_value_entity_idx on public.statements (value_entity_id);
create index terms_parent_idx on public.terms (parent_id);
