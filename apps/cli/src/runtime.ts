/**
 * Shared Novel Master CLI runtime (DB open + service factories).
 *
 * @module runtime
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerTokenizerNodeDriver } from "@novel-master/tokenizer-driver-node";
import { bootstrapNovelMaster, createPersistentPreferences, createPersistentState, open, type PersistentPreferences, type PersistentState, type TdbcConnection } from "@novel-master/core";
import { refreshUserVfsUnifiedToolTurnSnapshot } from "@novel-master/core/feature-flags";

import { createAgentRegistryService } from "@novel-master/core/agent";
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
  type CompactionConditionEvaluator,
  type CompactionConditionsStore,
} from "@novel-master/core/compaction";
import {
  createEventOrchestrator,
  createRunAgentHandlerDeps,
  createEventsConfigStore,
  SimpleEventBus,
  type EventOrchestrator,
  type EventsConfigStore,
} from "@novel-master/core/events";
import {
  createMessageService,
  createMessageTranscriptEffectsService,
  createProjectService,
  createSessionService,
  type MessageService,
  type MessageTranscriptEffectsService,
  type ProjectService,
  type SessionService,
} from "@novel-master/core/chat";
import {
  createProviderServices,
  createDefaultTokenCounterRegistry,
  type ModelRequestService,
  type ProviderModelService,
  type ProviderService,
  type SecretStore,
  type TokenCounterRegistry,
} from "@novel-master/core/provider";
import { createRegexConfigService, type RegexConfigService } from "@novel-master/core/regex";
import {
  createMessageCheckpointService,
  createSessionFsService,
  type MessageCheckpointService,
  type SessionFsService,
} from "@novel-master/core/session-fs";
import {
  createScopedVfsService,
  type VfsScope,
  type VfsService,
} from "@novel-master/core/vfs";
import {
  createSessionWorktreeSnapshotStore,
  createWorktreeService,
  type SessionWorktreeSnapshotStore,
  type WorktreeService,
} from "@novel-master/core/worktree";
import type { AgentRegistryService } from "@novel-master/core/agent";
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
  /** hide/show/truncate 消息 transcript 并 markDirty session worktree。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly scope: CliScopeResolver;
  readonly eventBus: SimpleEventBus;
  readonly eventsConfig: EventsConfigStore;
  readonly compactionConditions: CompactionConditionsStore;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  readonly worktreeSnapshot: SessionWorktreeSnapshotStore;
  readonly eventOrchestrator: EventOrchestrator;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  worktree(scope: VfsScope): WorktreeService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
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
  const userVfsUnifiedToolTurnEnabled = await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);
  const scope = new CliScopeResolver(state);

  const dbStore = resolveSkspDriver("windows").createStore(conn);
  const envStore =
    process.env.NM_SKSP_DISABLE_ENV === "1"
      ? undefined
      : createEnvSecretStore();
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: envStore,
  });
  if (process.env.NM_LLM_E2E_FETCH === "1" && process.env.NM_AGENT_MOCK_LLM !== "1") {
    installE2eLlmFetchCapture();
  }
  const providerBundle = createProviderServices(conn, secretStore);
  const modelRequests =
    process.env.NM_AGENT_MOCK_LLM === "1"
      ? createAgentMockModelRequests()
      : providerBundle.modelRequests;

  const tokenCounters = createDefaultTokenCounterRegistry({});

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);
  const worktreeSnapshot = createSessionWorktreeSnapshotStore();
  const messages = createMessageService(conn);
  const messageTranscriptEffects = createMessageTranscriptEffectsService(
    conn,
    worktreeSnapshot,
  );

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providerModels: providerBundle.providerModels,
  });

  const agentRegistry = createAgentRegistryService(conn, state);

  const eventOrchestrator = createEventOrchestrator({
    eventsConfig,
    eventBus,
    messages,
    messageTranscriptEffects,
    worktreeSnapshot,
    worktree: (s) => createWorktreeService(conn, s),
    runAgent: createRunAgentHandlerDeps({
      messages,
      agentRegistry,
      modelRequests,
      worktreeSnapshot,
      worktree: (s) => createWorktreeService(conn, s),
      sessionVfs: (projectId, sessionId) =>
        createScopedVfsService(conn, { kind: "session", projectId, sessionId }),
      messageCheckpoint: createMessageCheckpointService(conn),
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
    worktreeSnapshot,
    eventOrchestrator,
    agentRegistry,
    tokenCounters,
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn, worktreeSnapshot),
    messageCheckpoint: createMessageCheckpointService(conn),
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
    regexConfig,
  };
}
