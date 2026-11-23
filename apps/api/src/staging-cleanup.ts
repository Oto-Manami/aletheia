// どの下書きにも紐付いていない仮置きのファイルを片付ける（Issue #71）
//
// Bot・収集の処理は、ファイルを先に仮置きの場所（_staging/<経路>/）に置いてから下書きを作る。下書きを
// 作るところで失敗すると、どの下書きにも紐付かないファイルが残り、取り込みをやり直すたびに増える。
// - 1 日 1 回、仮置きの場所のファイルのうち、どの下書き（状態を問わない）の staged_files にも無く、
//   置いてから一定の日数がたったものを、ごみ箱に移す（Drive では 30 日間戻せる。決定記録 0048）
// - 置いたばかりのものは、下書きを作る途中かもしれないので触らない
// - 下書きが指しているものは、承認の後に保存できなかったもの（やり直しに使う）も含めて残す

import type { Database } from "@aletheia/db/client";
import { type FileStore, type FolderStore, STAGING } from "@aletheia/storage";
import { sql } from "kysely";

export interface CleanupResult {
  /** 見たファイルの数 */
  checked: number;
  /** ごみ箱に移した数 */
  trashed: number;
  /** 紐付いていないが、置いてから日が浅いので残した数 */
  recent: number;
  /** ごみ箱に移せなかった数 */
  failed: number;
}

/** どれかの下書きが指している仮置きのファイルの ID */
async function referencedKeys(db: Database): Promise<Set<string>> {
  const rows = await sql<{ key: string | null }>`
    select distinct f.value ->> 'storage_key' as key
    from public.intake_items i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.staged_files) = 'array' then i.staged_files else '[]'::jsonb end
    ) f
  `.execute(db);
  return new Set(rows.rows.flatMap((r) => (r.key ? [r.key] : [])));
}

export async function cleanupStaging(
  db: Database,
  files: FileStore & FolderStore,
  options: { olderThanDays?: number; limit?: number; now?: () => number } = {},
): Promise<CleanupResult> {
  const now = options.now ?? Date.now;
  const cutoff = now() - (options.olderThanDays ?? 7) * 24 * 60 * 60 * 1000;
  const limit = options.limit ?? 500;
  const result: CleanupResult = { checked: 0, trashed: 0, recent: 0, failed: 0 };
  // 一覧を取ってから下書きを読む（一覧の後に作られた下書きが指すファイルを、取りこぼさない）
  const routes = await files.listFolders([STAGING]);
  const listed = [];
  for (const route of routes) listed.push(...(await files.listFiles([STAGING, route.name])));
  const referenced = await referencedKeys(db);
  for (const file of listed) {
    result.checked++;
    if (referenced.has(file.key)) continue;
    const created = file.createdAt ? Date.parse(file.createdAt) : Number.NaN;
    // 置いた日時が分からないもの・日が浅いものは残す
    if (Number.isNaN(created) || created > cutoff) {
      result.recent++;
      continue;
    }
    if (result.trashed >= limit) break;
    try {
      await files.trash(file.key);
      result.trashed++;
    } catch (e) {
      result.failed++;
      console.error(
        `仮置きのファイルをごみ箱に移せませんでした: ${file.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return result;
}

function isFolderStore(files: FileStore): files is FileStore & FolderStore {
  return "listFolders" in files && "listFiles" in files;
}

/** 起動の 10 分後と、その後 1 日ごとに片付ける。止める関数を返す */
export function startStagingCleanupJob(
  db: Database,
  files: FileStore | undefined,
  options: { olderThanDays?: number; firstDelayMs?: number; intervalMs?: number } = {},
): () => void {
  if (!files || !isFolderStore(files)) return () => undefined;
  const store = files;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await cleanupStaging(db, store, {
        ...(options.olderThanDays !== undefined ? { olderThanDays: options.olderThanDays } : {}),
      });
      if (r.trashed + r.failed > 0) {
        console.log(
          `仮置きのファイルの片付け: ${r.checked} 件を見て、どの下書きにも紐付いていない ${r.trashed} 件をごみ箱に移しました（移せなかったもの ${r.failed} 件・日が浅いので残したもの ${r.recent} 件）`,
        );
      }
    } catch (e) {
      console.error(
        "仮置きのファイルを片付けられませんでした:",
        e instanceof Error ? e.message : e,
      );
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), options.firstDelayMs ?? 10 * 60 * 1000);
  const timer = setInterval(() => void run(), options.intervalMs ?? 24 * 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
