/**
 * Shared Novel Master CLI runtime (DB open + service factories).
 *
 * @module runtime
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerTokenizerNodeDriver } from "@novel-master/tokenizer-driver-node";
import {
  bootstrapNovelMaster,
  createAgentRegistryService,
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
  createDefaultTokenCounterRegistry,
  readTokenCounterModeFromPreferences,
  createEventOrchestrator,
  createRunAgentHandlerDeps,
  createEventsConfigStore,
  createMessageService,
  createPersistentPreferences,
  createPersistentState,
  createProjectService,
  createScopedVfsService,
  createSessionFsService,
  createSessionService,
  createProviderServices,
  createRegexConfigService,
  createSessionMacroCache,
  createWorktreeService,
  open,
  SimpleEventBus,
  type AgentRegistryService,
  type CompactionConditionEvaluator,
  type CompactionConditionsStore,
  type EventOrchestrator,
  type EventsConfigStore,
  type ModelRequestService,
  type ModelSamplingProfileService,
  type PersistentPreferences,
  type PersistentState,
  type ProviderModelService,
  type ProviderService,
  type RegexConfigService,
  type SecretStore,
  type MessageService,
  type ProjectService,
  type SessionFsService,
  type SessionService,
  type SessionMacroCache,
  type TdbcConnection,
  type VfsScope,
  type VfsService,
  type WorktreeService,
  type TokenCounterRegistry,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import {
  createCompositeSecretStore,
  createEnvSecretStore,
  resolveSkspDriver,
} from "@novel-master/core/sksp";
import { registerSkspWindowsDriver } from "@novel-master/sksp-windows";
import { createAgentMockModelRequests } from "./agent/mock-llm.js";
import { installE2eLlmFetchCapture } from "./test/e2e-llm-fetch.js";
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
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
  readonly scope: CliScopeResolver;
  readonly eventBus: SimpleEventBus;
  readonly eventsConfig: EventsConfigStore;
  readonly compactionConditions: CompactionConditionsStore;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  readonly macroCache: SessionMacroCache;
  readonly eventOrchestrator: EventOrchestrator;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  worktree(scope: VfsScope): WorktreeService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
  readonly modelSamplingProfiles: ModelSamplingProfileService;
  readonly regexConfig: RegexConfigService;
  readonly agentRegistry: AgentRegistryService;
  readonly tokenCounters: TokenCounterRegistry;
  readonly dbPath: string;
}

/**
 * Opens SQLite, bootstraps full schema, and returns service handles.
 */
export async function createNovelMasterRuntime(
  argv: readonly string[],
): Promise<NovelMasterRuntime> {
  registerBetterSqlite3Driver();
  registerSkspWindowsDriver();
  registerTokenizerNodeDriver();
  const dbPath = resolve(resolveDbPath(argv));
  await mkdir(dirname(dbPath), { recursive: true });

  const conn = await open(`tdbc:sqlite:file:${dbPath}`, {
    driver: "better-sqlite3",
  });
  await bootstrapNovelMaster(conn);

  const state = createPersistentState(conn);
  const regexConfig = createRegexConfigService(conn, state);
  const preferences = createPersistentPreferences(conn);
  const scope = new CliScopeResolver(state);

  const dbStore = resolveSkspDriver("windows").createStore(conn);
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: createEnvSecretStore(),
  });
  if (process.env.NM_LLM_E2E_FETCH === "1" && process.env.NM_AGENT_MOCK_LLM !== "1") {
    installE2eLlmFetchCapture();
  }
  const providerBundle = createProviderServices(conn, secretStore);
  const modelRequests =
    process.env.NM_AGENT_MOCK_LLM === "1"
      ? createAgentMockModelRequests()
      : providerBundle.modelRequests;

  const tokenCounters = createDefaultTokenCounterRegistry({
    getTokenizerOverride: () => readTokenCounterModeFromPreferences(preferences),
  });

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);
  const macroCache = createSessionMacroCache();
  const messages = createMessageService(conn);

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
  });

  const agentRegistry = createAgentRegistryService(conn);

  const eventOrchestrator = createEventOrchestrator({
    eventsConfig,
    eventBus,
    messages,
    macroCache,
    worktree: (s) => createWorktreeService(conn, s),
    runAgent: createRunAgentHandlerDeps({
      messages,
      agentRegistry,
      modelRequests,
      macroCache,
      worktree: (s) => createWorktreeService(conn, s),
      sessionFs: createSessionFsService(conn),
      sessionVfs: (projectId, sessionId) =>
        createScopedVfsService(conn, { kind: "session", projectId, sessionId }),
      eventBus,
      state,
      regexConfig,
    }),
  });

  return {
    conn,
    state,
    preferences,
    dbPath,
    eventBus,
    eventsConfig,
    compactionConditions,
    compactionConditionEvaluator,
    macroCache,
    eventOrchestrator,
    agentRegistry,
    tokenCounters,
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages,
    sessionFs: createSessionFsService(conn),
    scope,
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
    modelRequests,
    modelSamplingProfiles: providerBundle.modelSamplingProfiles,
    regexConfig,
  };
}
