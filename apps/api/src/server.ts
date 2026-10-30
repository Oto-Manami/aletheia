import { createDb } from "@aletheia/db/client";
import { serve } from "@hono/node-server";
import { DriveFileStore, type FileStore, LocalFileStore } from "@aletheia/storage";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

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
  },
  files,
  { viewerOrigins: config.VIEWER_ORIGINS },
);

serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`API を起動しました: http://${config.HOST}:${info.port}`);
});
