/**
 * Desktop SQLite file location.
 * Production: Electron userData/novel.db (isolated from CLI and mobile paths).
 * Tests/dev: NOVEL_MASTER_DB env override avoids requiring a live Electron app.
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function resolveDbPath(): string {
  if (process.env.NOVEL_MASTER_DB) {
    return process.env.NOVEL_MASTER_DB;
  }
  const { app } = require("electron") as typeof import("electron");
  return path.join(app.getPath("userData"), "novel.db");
}
