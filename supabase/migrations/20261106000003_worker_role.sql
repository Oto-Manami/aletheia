-- 閲覧サイトの役割に「作業者」（worker）を足す（設計書 決定記録 0032）
--
-- 役割は 運営者（admin）・作業者（worker）・閲覧者（viewer）の 3 つになる。これまでの参加者（viewer）は
-- そのまま閲覧者（見るだけ）になる。
-- 列挙型への値の追加は、同じトランザクションの中では使えないため、ファイルを分ける。

alter type public.app_role add value if not exists 'worker' after 'admin';
