-- 下書きの状態に「言及なし・戻せる間」（discarded）を足す（設計書 決定記録 0031）
--
-- 振り分けで「言及なし」にした直近 10 件は、すぐに削除せず、振り分け待ちに戻せるように置いておく。
-- 列挙型への値の追加は、同じトランザクションの中では使えないため、ファイルを分ける。

alter type public.intake_state add value if not exists 'discarded' after 'triage';
