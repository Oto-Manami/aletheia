import { createDb } from "@aletheia/db/client";
import { serve } from "@hono/node-server";
import { DriveFileStore, type FileStore, LocalFileStore } from "@aletheia/storage";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app.ts";
import { RoleCache } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { startImageHashJob } from "./image-hash-job.ts";
import { startStagingCleanupJob } from "./staging-cleanup.ts";
import { ThumbnailCache } from "./thumbnail-cache.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const files: FileStore =
  config.FILE_STORE === "drive"
    ? new DriveFileStore({
        clientId: config.GOOGLE_CLIENT_ID ?? "",
        clientSecret: config.GOOGLE_CLIENT_SECRET ?? "",
        refreshToken: config.GOOGLE_REFRESH_TOKEN ?? "",
        rootFolderId: config.DRIVE_ROOT_FOLDER_ID ?? "",
      })
    : new LocalFileStore(config.LOCAL_STORE_DIR);
const app = createApp(
  db,
  {
    serviceToken: config.API_SERVICE_TOKEN,
    getKey: createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL)),
    ...(config.ROLE_CACHE_SECONDS > 0
      ? { roleCache: new RoleCache(config.ROLE_CACHE_SECONDS * 1000) }
      : {}),
  },
  files,
  {
    viewerOrigins: config.VIEWER_ORIGINS,
    ...(config.THUMBNAIL_CACHE_DIR !== "off"
      ? { thumbnailCache: new ThumbnailCache(config.THUMBNAIL_CACHE_DIR) }
      : {}),
  },
);

// 画像の見た目のハッシュを裏で計算する（設計書 決定記録 0069）
if (config.IMAGE_HASH_JOB === "on") startImageHashJob(db, files);
// どの下書きにも紐付いていない仮置きのファイルを、1 日 1 回ごみ箱に移す（Issue #71）
if (config.STAGING_CLEANUP_JOB === "on") {
  startStagingCleanupJob(db, files, { olderThanDays: config.STAGING_CLEANUP_DAYS });
}

serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`API を起動しました: http://${config.HOST}:${info.port}`);
});
