/**
 * Shared Novel Master CLI runtime (DB open + service factories).
 *
 * @module runtime
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  bootstrapNovelMaster,
  createKkvService,
  createMessageService,
  createProjectService,
  createScopedVfsService,
  createSessionFsService,
  createSessionService,
  createProviderServices,
  createWorktreeService,
  open,
  type KkvService,
  type ModelRequestService,
  type ProviderModelService,
  type ProviderService,
  type SecretStore,
  type MessageService,
  type ProjectService,
  type SessionFsService,
  type SessionService,
  type TdbcConnection,
  type VfsScope,
  type VfsService,
  type WorktreeService,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import {
  createCompositeSecretStore,
  createEnvSecretStore,
  resolveSkspDriver,
} from "@novel-master/core/sksp";
import { registerSkspWindowsDriver } from "@novel-master/sksp-windows";
import {
  type CliConfig,
  loadCliConfig,
  mergeCliConfig,
  resolveConfigPath,
  saveCliConfig,
} from "./config/cli-config.js";
import { CliScopeResolver } from "./config/resolve-scope.js";
import { extractDbPath } from "./vfs/parse-args.js";

const DEFAULT_DB = "./.novel-master/novel.db";

/**
 * Resolves database file path: NOVEL_MASTER_DB > --db > default.
 */
export function resolveDbPath(argv: readonly string[]): string {
  if (process.env.NOVEL_MASTER_DB) {
    return process.env.NOVEL_MASTER_DB;
  }
  const fromFlag = extractDbPath(argv).dbPath;
  if (fromFlag != null) {
    return fromFlag;
  }
  return DEFAULT_DB;
}

/** Open connection with all domain services wired. */
export interface NovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly kkv: KkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
  readonly configPath: string;
  readonly scope: CliScopeResolver;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  worktree(scope: VfsScope): WorktreeService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
  /** Merges into `config.json` and refreshes the in-memory scope resolver. */
  setCliContext(patch: Partial<CliConfig>): Promise<void>;
}

/**
 * Opens SQLite, bootstraps full schema, and returns service handles.
 */
export async function createNovelMasterRuntime(
  argv: readonly string[],
): Promise<NovelMasterRuntime> {
  registerBetterSqlite3Driver();
  registerSkspWindowsDriver();
  const dbPath = resolve(resolveDbPath(argv));
  const configPath = resolveConfigPath(dbPath);
  await mkdir(dirname(dbPath), { recursive: true });
  let config = await loadCliConfig(configPath);
  let scope = new CliScopeResolver(config, { configPath });

  const conn = await open(`tdbc:sqlite:file:${dbPath}`, {
    driver: "better-sqlite3",
  });
  await bootstrapNovelMaster(conn);

  const dbStore = resolveSkspDriver("windows").createStore(conn);
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: createEnvSecretStore(),
  });
  const providerBundle = createProviderServices(conn, secretStore);

  const setCliContext = async (patch: Partial<CliConfig>): Promise<void> => {
    await saveCliConfig(configPath, patch);
    config = mergeCliConfig(config, patch);
    scope.replaceConfig(config);
  };

  return {
    conn,
    kkv: createKkvService(conn),
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages: createMessageService(conn),
    sessionFs: createSessionFsService(conn),
    configPath,
    get scope() {
      return scope;
    },
    setCliContext,
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    worktree: (scope) => createWorktreeService(conn, scope),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    modelRequests: providerBundle.modelRequests,
  };
}
