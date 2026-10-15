import { insert, type Queryable } from "./sql.ts";

/**
 * 公開区分・有料無料・承認状態の組み合わせをひととおり含むテスト用データ。
 * 人物・情報源の名前は架空のもの。
 */
export async function seed(c: Queryable) {
  const person = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "試験 花子",
    reading: "しけん はなこ",
    aliases: ["はなちゃん"],
    classification: "public",
  });
  const otherMember = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "試験 次郎",
    classification: "public",
  });
  const privatePerson = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "内部 三郎",
    classification: "private",
  });
  const school = await insert(c, "public.entities", {
    type: "place",
    canonical_name: "架空高校",
    classification: "private",
  });
  const venue = await insert(c, "public.entities", {
    type: "place",
    canonical_name: "架空ホール",
    classification: "public",
  });
  // 公開区分を指定しなかった行（既定で private になる）
  const unclassified = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "未設定 四郎",
  });

  const freeChannel = await insert(c, "public.channels", {
    key: "sns:test_account",
    name: "テスト SNS",
    kind: "sns",
    owner_entity_id: person,
    availability: "free",
    item_unit: "post",
    classification: "public",
  });
  const paidChannel = await insert(c, "public.channels", {
    key: "message",
    name: "テスト メッセージ",
    kind: "message",
    owner_entity_id: person,
    availability: "paid",
    item_unit: "post",
    classification: "public",
  });
  const mixedChannel = await insert(c, "public.channels", {
    key: "web:test_site",
    name: "テスト Web",
    kind: "web",
    availability: "mixed",
    item_unit: "post",
    classification: "public",
  });

  async function postWithText(
    channelId: string,
    externalId: string,
    text: string,
    opts: { classification?: string; availability?: string } = {},
  ) {
    const post = await insert(c, "public.posts", {
      channel_id: channelId,
      external_id: externalId,
      published_date: "2026-10-12",
      published_date_precision: "day",
      classification: opts.classification ?? "public",
      ...(opts.availability ? { availability: opts.availability } : {}),
    });
    const asset = await insert(c, "public.assets", {
      post_id: post,
      position: 1,
      media_type: "text",
      classification: opts.classification ?? "public",
    });
    const assetText = await insert(c, "public.asset_texts", {
      asset_id: asset,
      text_type: "body",
      content: text,
      classification: opts.classification ?? "public",
    });
    return { post, asset, assetText };
  }

  const freePost = await postWithText(
    freeChannel,
    "1001",
    "今日は{{recipient}}さんと一緒に、ＡＢＣのお菓子を食べました。",
  );
  const privatePost = await postWithText(freeChannel, "1002", "内部向けの記録です。お菓子の話。", {
    classification: "private",
  });
  const paidPost = await postWithText(
    paidChannel,
    "2001",
    "有料の情報源での発言。好きな食べ物はお菓子。",
  );
  const mixedFreePost = await postWithText(mixedChannel, "3001", "無料で公開された記事。", {
    availability: "free",
  });
  const mixedDefaultPost = await postWithText(mixedChannel, "3002", "有料かどうか未確定の記事。");

  const publicEvent = await insert(c, "public.events", {
    kind: "event",
    title: "架空ランウェイ 2026",
    starts_on: "2026-09-01",
    date_precision: "day",
    venue_id: school,
    attributes: { event_type: "fashion_show" },
    classification: "public",
  });
  const venueEvent = await insert(c, "public.events", {
    kind: "live",
    title: "架空ライブ",
    starts_on: "2026-08-01",
    date_precision: "day",
    venue_id: venue,
    classification: "public",
  });
  const privateEvent = await insert(c, "public.events", {
    kind: "event",
    title: "内部の出来事",
    starts_on: "2026-07-01",
    date_precision: "day",
    classification: "private",
  });

  const acceptedParticipant = await insert(c, "public.event_participants", {
    event_id: publicEvent,
    entity_id: person,
    role: "performer",
    status: "appeared",
    classification: "public",
  });
  const rejectedParticipant = await insert(c, "public.event_participants", {
    event_id: publicEvent,
    entity_id: otherMember,
    role: "performer",
    status: "appeared",
    origin: "ai",
    confidence: 0.4,
    review_state: "rejected",
    classification: "public",
  });

  const selfStatement = await insert(c, "public.statements", {
    subject_id: person,
    property: "favorite_food",
    value_text: "お菓子",
    speaker_type: "self",
    speaker_entity_id: person,
    evidence_asset_id: freePost.asset,
    classification: "public",
  });
  const paidStatement = await insert(c, "public.statements", {
    subject_id: person,
    property: "favorite_food",
    value_text: "お菓子",
    speaker_type: "self",
    speaker_entity_id: person,
    evidence_asset_id: paidPost.asset,
    classification: "public",
  });
  const mentionStatement = await insert(c, "public.statements", {
    subject_id: person,
    property: "nickname",
    value_text: "はなちゃん",
    speaker_type: "third_party",
    speaker_entity_id: otherMember,
    classification: "public",
  });
  const privateStatement = await insert(c, "public.statements", {
    subject_id: person,
    property: "school",
    value_entity_id: school,
    speaker_type: "self",
    classification: "private",
  });

  const authorLink = await insert(c, "public.links", {
    from_type: "post",
    from_id: freePost.post,
    to_type: "entity",
    to_id: person,
    role: "author",
    classification: "public",
  });
  const rejectedLink = await insert(c, "public.links", {
    from_type: "asset",
    from_id: freePost.asset,
    to_type: "entity",
    to_id: otherMember,
    role: "appears",
    origin: "ai",
    confidence: 0.3,
    review_state: "rejected",
    classification: "public",
  });
  const paidLink = await insert(c, "public.links", {
    from_type: "post",
    from_id: paidPost.post,
    to_type: "entity",
    to_id: person,
    role: "author",
    classification: "public",
  });

  // 公開区分ごとの人物・統合済みの人物
  const unusedPerson = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "機密 六郎",
    classification: "private",
  });
  const mergedPerson = await insert(c, "public.entities", {
    type: "person",
    canonical_name: "試験 はな子",
    merged_into: person,
    classification: "public",
  });

  // エンティティ同士の関係
  const group = await insert(c, "public.entities", {
    type: "group",
    canonical_name: "架空グループ",
    classification: "public",
  });
  const memberOf = await insert(c, "public.entity_relations", {
    subject_id: person,
    object_id: group,
    relation: "member_of",
    valid_from: "2024-01-01",
    valid_from_precision: "day",
    classification: "public",
  });
  const relationToPrivate = await insert(c, "public.entity_relations", {
    subject_id: privatePerson,
    object_id: group,
    relation: "member_of",
    classification: "public",
  });
  const rejectedRelation = await insert(c, "public.entity_relations", {
    subject_id: otherMember,
    object_id: group,
    relation: "member_of",
    origin: "ai",
    confidence: 0.5,
    review_state: "rejected",
    classification: "public",
  });

  // 出来事の中身（セットリスト）
  const publicSong = await insert(c, "public.entities", {
    type: "work",
    subtype: "song",
    canonical_name: "架空の歌",
    classification: "public",
  });
  const privateSong = await insert(c, "public.entities", {
    type: "work",
    subtype: "song",
    canonical_name: "未発表の歌",
    classification: "private",
  });
  const songItem = await insert(c, "public.event_items", {
    event_id: venueEvent,
    position: 1,
    item_type: "song",
    work_id: publicSong,
    classification: "public",
  });
  const titledPrivateSongItem = await insert(c, "public.event_items", {
    event_id: venueEvent,
    position: 2,
    item_type: "song",
    work_id: privateSong,
    title: "新曲",
    classification: "public",
  });
  const untitledPrivateSongItem = await insert(c, "public.event_items", {
    event_id: venueEvent,
    position: 3,
    item_type: "song",
    work_id: privateSong,
    classification: "public",
  });

  // 上位が非公開の出来事
  const childOfPrivateEvent = await insert(c, "public.events", {
    parent_id: privateEvent,
    kind: "event",
    title: "内部の出来事の一部",
    starts_on: "2026-07-01",
    date_precision: "day",
    classification: "public",
  });

  // 発信者が非公開の情報源
  const privateOwnerChannel = await insert(c, "public.channels", {
    key: "sns:private_owner",
    name: "テスト SNS 2",
    kind: "sns",
    owner_entity_id: privatePerson,
    availability: "free",
    item_unit: "post",
    classification: "public",
  });

  // 語彙
  const vocabulary = await insert(c, "public.vocabularies", {
    key: "content_kind",
    name: "素材の種類",
    classification: "public",
  });
  const publicTerm = await insert(c, "public.terms", {
    vocabulary_id: vocabulary,
    name: "自撮り",
    classification: "public",
  });
  const privateTerm = await insert(c, "public.terms", {
    vocabulary_id: vocabulary,
    name: "内部の分類",
    classification: "private",
  });
  const childOfPrivateTerm = await insert(c, "public.terms", {
    vocabulary_id: vocabulary,
    parent_id: privateTerm,
    name: "内部の分類の下位",
    classification: "public",
  });

  return {
    unusedPerson,
    mergedPerson,
    group,
    memberOf,
    relationToPrivate,
    rejectedRelation,
    publicSong,
    privateSong,
    songItem,
    titledPrivateSongItem,
    untitledPrivateSongItem,
    childOfPrivateEvent,
    privateOwnerChannel,
    vocabulary,
    publicTerm,
    privateTerm,
    childOfPrivateTerm,
    person,
    otherMember,
    privatePerson,
    school,
    venue,
    unclassified,
    freeChannel,
    paidChannel,
    mixedChannel,
    freePost,
    privatePost,
    paidPost,
    mixedFreePost,
    mixedDefaultPost,
    publicEvent,
    venueEvent,
    privateEvent,
    acceptedParticipant,
    rejectedParticipant,
    selfStatement,
    paidStatement,
    mentionStatement,
    privateStatement,
    authorLink,
    rejectedLink,
    paidLink,
  };
}
