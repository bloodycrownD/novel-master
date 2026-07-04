import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapNovelMaster, createPersistentState, open, type TdbcConnection } from "@novel-master/core";

import { createMessageCheckpointService } from "@novel-master/core/message-checkpoint";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

/** Parses `nm vfs list` stdout (`DIR|FILE\\t<path>` per line) into logical paths. */
export function vfsListPaths(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const tab = line.indexOf("\t");
      return tab >= 0 ? line.slice(tab + 1) : line;
    });
}

/** File rows only (excludes `DIR` directory entries). */
export function vfsListFilePaths(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .filter(line => line.startsWith("FILE\t"))
    .map(line => line.slice(line.indexOf("\t") + 1));
}

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

export interface CliState {
  readonly currentProjectId?: string;
  readonly currentSessionId?: string;
  readonly currentProviderId?: string;
  readonly currentModelId?: string;
  readonly currentRegexGroupId?: string;
}

export interface SavedModelListRow {
  readonly id: string;
  readonly displayName: string;
  readonly vendorModelId: string;
}

/** 解析 `nm provider model list` TSV：`uuid\\tdisplayName\\tvendorModelId`。 */
export function parseSavedModelList(stdout: string): SavedModelListRow[] {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, displayName, vendorModelId] = line.split("\t");
      if (id == null || vendorModelId == null) {
        throw new Error(`invalid saved model list line: ${line}`);
      }
      return {
        id,
        displayName: displayName ?? "",
        vendorModelId,
      };
    });
}

/** 在当前 provider 下创建 saved model 并返回其 UUID。 */
export function createSavedModelId(
  dbPath: string,
  vendorModelId: string,
  providerId?: string,
): string {
  if (providerId != null) {
    runNm(["provider", "use", "--providerId", providerId, "--db", dbPath]);
  }
  const create = runNm([
    "provider",
    "model",
    "create",
    "--vendorModelId",
    vendorModelId,
    "--db",
    dbPath,
  ]);
  if (create.status !== 0) {
    throw new Error(create.stderr || "provider model create failed");
  }
  const list = runNm(["provider", "model", "list", "--db", dbPath]);
  if (list.status !== 0) {
    throw new Error(list.stderr || "provider model list failed");
  }
  const row = parseSavedModelList(list.stdout).find(
    (item) => item.vendorModelId === vendorModelId,
  );
  if (row == null) {
    throw new Error(`saved model not found after create: ${vendorModelId}`);
  }
  return row.id;
}

/** 查询已保存模型的 UUID（须已 `provider use` 到目标服务商）。 */
export function savedModelIdByVendor(
  dbPath: string,
  vendorModelId: string,
): string {
  const list = runNm(["provider", "model", "list", "--db", dbPath]);
  if (list.status !== 0) {
    throw new Error(list.stderr || "provider model list failed");
  }
  const row = parseSavedModelList(list.stdout).find(
    (item) => item.vendorModelId === vendorModelId,
  );
  if (row == null) {
    throw new Error(`saved model not found: ${vendorModelId}`);
  }
  return row.id;
}

/** 创建 mock 服务商并批量 save 模型，返回 vendor → UUID 映射。 */
export function seedMockProviderModels(
  dbPath: string,
  vendorIds: readonly string[],
  env?: NodeJS.ProcessEnv,
): Map<string, string> {
  const runOpts = env != null ? { env } : undefined;
  runNm(
    [
      "provider",
      "create",
      "--providerId",
      "mock",
      "--protocol",
      "openai",
      "--baseUrl",
      "http://127.0.0.1/v1",
      "--apiKey",
      "test",
      "--db",
      dbPath,
    ],
    runOpts,
  );
  runNm(["provider", "use", "--providerId", "mock", "--db", dbPath], runOpts);
  const ids = new Map<string, string>();
  for (const vendorModelId of vendorIds) {
    ids.set(vendorModelId, createSavedModelId(dbPath, vendorModelId));
  }
  return ids;
}

async function openConn(dbPath: string): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open(`tdbc:sqlite:file:${dbPath}`, { driver: "better-sqlite3" });
  await bootstrapNovelMaster(conn);
  return conn;
}

/** Reads workspace pointers from DB-backed {@link PersistentState}. */
export async function readCliState(dbPath: string): Promise<CliState> {
  const conn = await openConn(dbPath);
  try {
    const state = createPersistentState(conn);
    const currentProjectId = await state.getCurrentProjectId();
    const currentSessionId = await state.getCurrentSessionId();
    const currentProviderId = await state.getCurrentProviderId();
    const currentModelId = await state.getCurrentModelId();
    const currentRegexGroupId = await state.getCurrentRegexGroupId();
    return {
      currentProjectId: currentProjectId || undefined,
      currentSessionId: currentSessionId || undefined,
      currentProviderId: currentProviderId || undefined,
      currentModelId: currentModelId || undefined,
      currentRegexGroupId: currentRegexGroupId || undefined,
    };
  } finally {
    await conn.close();
  }
}

/** Directory containing the DB file (for custom `--db` layout tests). */
export function dbDir(dbPath: string): string {
  return dirname(dbPath);
}

/** Captures a message checkpoint (Agent step boundary) for e2e setup. */
export async function captureMessageCheckpoint(
  dbPath: string,
  sessionId: string,
  projectId: string,
  messageId: string,
): Promise<void> {
  const conn = await openConn(dbPath);
  try {
    const checkpoint = createMessageCheckpointService(conn);
    await checkpoint.capture(sessionId, projectId, messageId);
  } finally {
    await conn.close();
  }
}

/** Counts checkpoint file pointers stored for a session. */
export async function countSessionCheckpointPointers(
  dbPath: string,
  sessionId: string,
): Promise<number> {
  const conn = await openConn(dbPath);
  try {
    const rows = await conn.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM message_checkpoint_file WHERE session_id = ?",
      [sessionId],
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await conn.close();
  }
}
