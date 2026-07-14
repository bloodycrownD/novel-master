/**
 * Desktop runtime: better-sqlite3 + platform SKSP + full Core service wiring.
 * Mirrors create-mobile-runtime.ts; secret store uses SKSP + env composite (CLI parity).
 *
 * @module runtime/create-desktop-runtime
 */
import {
  createAgentRegistryService,
} from "@novel-master/core/agent";
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
} from "@novel-master/core/compaction";
import {
  createDefaultTokenCounterRegistry,
  createProviderServices,
} from "@novel-master/core/provider";
import {
  createEventOrchestrator,
  createEventsConfigStore,
  createRunAgentHandlerDeps,
  SimpleEventBus,
} from "@novel-master/core/events";
import {
  createMessageService,
  createMessageTranscriptEffectsService,
  createProjectService,
  createSessionService,
  createUserVfsTurnServiceBundle,
} from "@novel-master/core/chat";
import {
  createPersistentPreferences,
  createPersistentState,
} from "@novel-master/core";
import { refreshUserVfsUnifiedToolTurnSnapshot } from "@novel-master/core/feature-flags";
import { createRegexConfigService } from "@novel-master/core/regex";
import {
  createMessageCheckpointService,
} from "@novel-master/core/message-checkpoint";
import {
  createSessionFsService,
} from "@novel-master/core/session-fs";
import {
  createScopedVfsService,
  type VfsScope,
} from "@novel-master/core/vfs";
import {
  createSessionWorktreeBlockStore,
  createWorktreeService,
} from "@novel-master/core/worktree";
import { createKkvService } from "@novel-master/core/kkv";
import { createSessionKkvService } from "@novel-master/core/session-kkv";
import {
  createCompositeSecretStore,
  createEnvSecretStore,
  resolveSkspDriver,
} from "@novel-master/core/sksp";
import { getDesktopConnection } from "./connection.js";
import { getPlatformSkspName } from "./register-platform-drivers.js";
import { resolveDbPath } from "./resolve-db-path.js";
import { ensureLlmFetchConfigured } from "./setup-llm-fetch.js";
import type { DesktopNovelMasterRuntime } from "./types.js";

/**
 * Opens the app DB once and returns service handles aligned with CLI/mobile runtime.
 */
export async function createDesktopNovelMasterRuntime(): Promise<DesktopNovelMasterRuntime> {
  ensureLlmFetchConfigured();
  const conn = await getDesktopConnection();
  const dbPath = resolveDbPath();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const userVfsUnifiedToolTurnEnabled = await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);
  const regexConfig = createRegexConfigService(conn, state);

  const skspName = getPlatformSkspName();
  const dbStore = resolveSkspDriver(skspName).createStore(conn);
  const envStore =
    process.env.NM_SKSP_DISABLE_ENV === "1"
      ? undefined
      : createEnvSecretStore();
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: envStore,
  });

  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({
    savedModels: providerBundle.savedModelRepo,
  });

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);
  const worktreeBlockStore = createSessionWorktreeBlockStore();
  const messages = createMessageService(conn);
  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  const { userVfsTurn, appendToolTurnBridge } = createUserVfsTurnServiceBundle(conn);

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
    runAgent: createRunAgentHandlerDeps({
      messages,
      agentRegistry,
      modelRequests: providerBundle.modelRequests,
      savedModels: providerBundle.savedModelRepo,
      worktreeBlockStore,
      worktree: (s) => createWorktreeService(conn, s),
      sessionVfs: (projectId, sessionId) =>
        createScopedVfsService(conn, {
          kind: "session",
          projectId,
          sessionId,
        }),
      messageCheckpoint: createMessageCheckpointService(conn),
      sessionKkv,
      eventBus,
      state,
      regexConfig,
    }),
  });

  return {
    conn,
    dbPath,
    state,
    preferences,
    kkv,
    eventBus,
    eventsConfig,
    compactionConditions,
    compactionConditionEvaluator,
    worktreeBlockStore,
    eventOrchestrator,
    agentRegistry,
    tokenCounters,
    projects: createProjectService(conn),
    sessions: createSessionService(conn),
    messages,
    messageTranscriptEffects,
    appendToolTurnBridge,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    worktree: (scope: VfsScope) => createWorktreeService(conn, scope),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    savedModelRepo: providerBundle.savedModelRepo,
    modelRequests: providerBundle.modelRequests,
    regexConfig,
    userVfsTurn,
  };
}
