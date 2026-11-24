-- 使っていない人物・作品の全文検索の索引を外す（設計書 oto-manami-project#110）
--
-- entities_search_idx（PGroonga。canonical_name・reading・aliases）は、どの検索からも使っていない。
-- 人物・作品の名前は ilike や正規化した名前の一致で探していて、行も数百なので順に比べれば足りる。
-- PGroonga は索引の列ごとに内部の表・辞書・索引のファイルを作り、それぞれが最初から一定の大きさを取る。
-- この索引だけで 100 MB ほど（データベースの大きさの 3 割）を使っていた。
--
-- 流した後に、使わなくなった内部の表を片付ける（運営者が SQL エディタで流す）:
--   select pgroonga_vacuum();
-- 名前で全文検索が要るようになったら、1 つの列（名前・読み・別名をまとめた配列）に索引を作る。

drop index public.entities_search_idx;
