import { createDb } from "@aletheia/db/client";
import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = createApp(db, {
  serviceToken: config.API_SERVICE_TOKEN,
  getKey: createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL)),
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`API を起動しました: http://localhost:${info.port}`);
});
