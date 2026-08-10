/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import {
  createAgentAbortRegistry,
  createAgentRegistryService,
  createAgentStreamRegistry,
} from '@novel-master/core/agent';
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
} from '@novel-master/core/compaction';
import {
  createEventOrchestrator,
  createRunAgentHandlerDeps,
  createEventsConfigStore,
  SimpleEventBus,
} from '@novel-master/core/events';
import {
  createChatServices,
  createMessageTranscriptEffectsService,
  createUserVfsTurnServiceBundle,
} from '@novel-master/core/chat';
import {
  createPersistentPreferences,
  createPersistentState,
} from '@novel-master/core';
import { refreshUserVfsUnifiedToolTurnSnapshot } from '@novel-master/core/feature-flags';
import {
  createProviderServices,
  createDefaultTokenCounterRegistry,
} from '@novel-master/core/provider';
import { createRegexConfigService } from '@novel-master/core/regex';
import { createMessageCheckpointService } from '@novel-master/core/message-checkpoint';
import { createSessionFsService } from '@novel-master/core/session-fs';
import { createScopedVfsService, type VfsScope } from '@novel-master/core/vfs';
import {
  createWorkplaceService,
} from '@novel-master/core/workplace';
import { createKkvService } from '@novel-master/core/kkv';
import { createSessionKkvService } from '@novel-master/core/session-kkv';
import {
  createCompositeSecretStore,
  resolveSkspDriver,
} from '@novel-master/core/sksp';
import { getMobileConnection } from '../db/connection';
import { ensureLlmFetchConfigured } from './setup-llm-fetch';
import type { MobileNovelMasterRuntime } from './types';

/**
 * Opens the app DB once and returns service handles aligned with CLI runtime.
 */
export async function createMobileNovelMasterRuntime(): Promise<MobileNovelMasterRuntime> {
  const conn = await getMobileConnection();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const userVfsUnifiedToolTurnEnabled =
    await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);

  const regexConfig = createRegexConfigService(conn, state);
  const agentRegistry = createAgentRegistryService(conn, state);
  const abortRegistry = createAgentAbortRegistry();
  const streamRegistry = createAgentStreamRegistry();

  const secretStore = createCompositeSecretStore({
    db: resolveSkspDriver('android').createStore(conn),
  });
  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({});

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);

  const chat = createChatServices(conn, { state, agentRegistry });
  const { projects, sessions, messages } = chat;

  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  const { userVfsTurn, appendToolTurnBridge } =
    createUserVfsTurnServiceBundle(conn);

  let compactionConditionEvaluator:
    | ReturnType<typeof createCompactionConditionEvaluator>
    | undefined;
  const lazyCompactionConditionEvaluator: ReturnType<
    typeof createCompactionConditionEvaluator
  > = {
    shouldRequestCompaction(session, evaluation) {
      if (compactionConditionEvaluator == null) {
        compactionConditionEvaluator = createCompactionConditionEvaluator({
          conditionsStore: compactionConditions,
          tokenCounters,
          providerModels: providerBundle.providerModels,
        });
      }
      return compactionConditionEvaluator.shouldRequestCompaction(
        session,
        evaluation,
      );
    },
  };

  const eventOrchestrator = createEventOrchestrator({
    eventsConfig,
    eventBus,
    messages,
    messageTranscriptEffects,
    sessionKkv,
    runAgent: createRunAgentHandlerDeps({
      messages,
      agentRegistry,
      modelRequests: providerBundle.modelRequests,
      savedModels: providerBundle.savedModelRepo,
      workplace: s => createWorkplaceService(conn, s),
      sessionVfs: (projectId, sessionId) =>
        createScopedVfsService(conn, { kind: 'session', projectId, sessionId }),
      messageCheckpoint: createMessageCheckpointService(conn),
      sessionKkv,
      eventBus,
      state,
      regexConfig,
    }),
  });

  setTimeout(() => {
    ensureLlmFetchConfigured();
  }, 0);

  return {
    conn,
    state,
    preferences,
    kkv,
    eventBus,
    eventsConfig,
    compactionConditions,
    compactionConditionEvaluator: lazyCompactionConditionEvaluator,
    eventOrchestrator,
    agentRegistry,
    abortRegistry,
    streamRegistry,
    tokenCounters,
    projects,
    sessions,
    messages,
    messageTranscriptEffects,
    appendToolTurnBridge,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    globalVfs: () => createScopedVfsService(conn, { kind: 'global' }),
    projectVfs: projectId =>
      createScopedVfsService(conn, { kind: 'project', projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, { kind: 'session', projectId, sessionId }),
    workplace: (scope: VfsScope) => createWorkplaceService(conn, scope),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    savedModelRepo: providerBundle.savedModelRepo,
    providerRepo: providerBundle.providerRepo,
    modelRequests: providerBundle.modelRequests,
    regexConfig,
    userVfsTurn,
  };
}
