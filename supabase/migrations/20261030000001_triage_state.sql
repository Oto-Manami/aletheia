-- 下書きの状態に「振り分け待ち」（triage）を足す（設計書 決定記録 0021）
--
-- 全件を取り込む経路（メンバーの公式ブログなど）の下書きは、振り分け待ちから始まる。
-- 列挙型への値の追加は、同じトランザクションの中では使えないため、ファイルを分ける。

alter type public.intake_state add value if not exists 'triage' before 'pending';
