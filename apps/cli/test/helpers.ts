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
