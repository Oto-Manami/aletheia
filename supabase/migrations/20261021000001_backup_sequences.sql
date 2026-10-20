-- バックアップ用のロールが、連番（シーケンス）の現在の値も読めるようにする（設計書 決定記録 0016）
--
-- SQL のダンプ（pg_dump）は、表の行と一緒に連番の値を書き出す。読めないとダンプが失敗する。
-- 読み取りだけを許す（値を進める usage・update は許さない）。

grant select on all sequences in schema public, app to aletheia_backup;

-- これから作る連番にも同じ権限を付ける
alter default privileges in schema public grant select on sequences to aletheia_backup;
alter default privileges in schema app grant select on sequences to aletheia_backup;
