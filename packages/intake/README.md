# @aletheia/intake

取り込みの下書き（`intake_items.draft`）の形と、承認・却下・保留の処理。

機械（取り込み処理・AI）は下書きを作るだけで、事実の層には書き込まない。人が確認・修正して承認したときに、`approveIntake` が 1 つのトランザクションで事実の層に反映する。途中で失敗したら何も反映しない。

## 下書きの形（version 1）

```jsonc
{
  "version": 1,
  "post": {
    "title": "元の素材にあるタイトル（無ければ省く）",
    "published_at": "2026-10-12T21:30:00+09:00",
    "published_date": "2026-10-12",
    "published_date_precision": "day",
    "url": "https://example.com/...",
    "classification": "public", // 必須。素材・紐付け・言明は、指定が無ければこれを引き継ぐ
  },
  "assets": [
    // 並び順がそのまま投稿の中の順番になる。ref は下書きの中だけで使う名前
    { "ref": "body", "media_type": "text", "texts": [{ "text_type": "body", "content": "..." }] },
    {
      "ref": "photo-1",
      "media_type": "image",
      "sha256": "...",
      "files": [{ "variant": "original", "provider": "gdrive", "storage_key": "..." }],
    },
  ],
  "links": [
    {
      "from": "post",
      "to_type": "entity",
      "to_id": "<人物の ID>",
      "role": "author",
      "origin": "rule",
    },
    // 機械の提案は出どころと確信度をつける。accepted: false は「却下した提案」として記録する
    {
      "from": { "asset": "photo-1" },
      "to_type": "entity",
      "to_id": "<人物の ID>",
      "role": "appears",
      "origin": "ai",
      "confidence": 0.8,
    },
  ],
  "statements": [
    {
      "subject_id": "<人物の ID>",
      "property": "favorite_food",
      "value_text": "...",
      "speaker_type": "self",
      "evidence_asset": "body",
      "origin": "ai",
      "confidence": 0.7,
    },
  ],
}
```

- 複数ページのコンテンツは 1 ページ（見開きなら 1 枚）を 1 素材にし、`attributes` にページ番号（`page_from` / `page_to`、表紙などは `page_label`）を入れる。映像の切り出しは `clip_from` / `clip_to`（秒）
- 紐付けの行き先（`to_type`）は `entity` / `event` / `event_item`（記事・コーナー・曲）/ `term`。誌面のスキャンは掲載記事に `part_of` でつなぐ
- 日付のみは `YYYY-MM-DD`（JST の暦日）、日時はタイムゾーンつき
- 人が付けたもの（`origin: "human"`、既定）の確信度は 1。承認の画面で人が書き換えた提案は、`origin: "human"`・確信度 1 にして渡す（最初に提案した機械の情報は `evidence` に残す）
- 情報源・外部 ID・取り込みの経路・取得日時は、下書きではなく `intake_items` の列に持つ

## 処理

| 関数                                                 | 内容                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `approveIntake(db, id, { reviewerId, draft, note })` | 承認して反映する。`draft` を渡すと、人が修正した内容で反映し、それを下書きにも残す |
| `rejectIntakeIn(trx, id, ...)`                       | 却下する。事実の層には何も入れない                                                 |
| `holdIntakeIn(trx, id, ...)`                         | 保留する。後から承認・却下できる                                                   |

承認・却下済みの下書きは、もう一度承認できない（`already_decided`）。

## 取り込みの経路と補完

下書きは経路（`intake_items.route`）ごとに持つ。経路は `fetch`（定期取得）/ `discord`（入口チャンネル）/ `migration`（初回の移行）/ `archive:<名前>`（他のアーカイブ）。

同じ投稿（情報源と外部 ID が同じ）が別の経路から既に入っている場合、承認は**既存の投稿への補完**になる（結果の `mode` が `supplemented`）。

- 投稿の項目は、空いているところだけを埋める。既にある値は変えない
- 同じ素材（SHA-256 か見た目のハッシュが一致、テキストは本文が一致）は加えない。下書きの中でその素材を指す紐付け・言明は、既にある素材につなぐ
- 新しい素材は、投稿の中の末尾に並べる
- 既にある紐付け・同じ内容の言明は加えない

より画質の良い素材への差し替え（同じ内容のまとまりの代表の入れ替え）は、この処理には含めない。

ファイル実体の移動（Drive の承認待ちの場所から本来の場所へ、却下時は却下の場所へ）は、この処理には含めない。承認の結果を受けて、ファイルを扱う処理が行う。
