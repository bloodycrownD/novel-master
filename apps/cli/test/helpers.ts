import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapNovelMaster,
  createConfigService,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawns the CLI entry via tsx (same as other e2e tests). */
export function runNm(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; input?: string },
): SpawnResult {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...options?.env },
      input: options?.input,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export interface CliConfig {
  readonly currentProjectId?: string;
  readonly currentSessionId?: string;
  readonly currentProviderId?: string;
  readonly currentModelId?: string;
}

async function openConn(dbPath: string): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open(`tdbc:sqlite:file:${dbPath}`, { driver: "better-sqlite3" });
  await bootstrapNovelMaster(conn);
  return conn;
}

/** Reads CLI config values from the DB-backed ConfigService. */
export async function readCliConfig(dbPath: string): Promise<CliConfig> {
  const conn = await openConn(dbPath);
  try {
    const config = createConfigService(conn);
    const currentProjectId = await config.get("currentProjectId");
    const currentSessionId = await config.get("currentSessionId");
    const currentProviderId = await config.get("currentProviderId");
    const currentModelId = await config.get("currentModelId");
    return {
      currentProjectId: currentProjectId || undefined,
      currentSessionId: currentSessionId || undefined,
      currentProviderId: currentProviderId || undefined,
      currentModelId: currentModelId || undefined,
    };
  } finally {
    await conn.close();
  }
}

/** Directory containing the DB file (for custom `--db` layout tests). */
export function dbDir(dbPath: string): string {
  return dirname(dbPath);
}
