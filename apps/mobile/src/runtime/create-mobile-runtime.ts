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
import { SimpleEventBus } from '@novel-master/core/events';
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
import {
  createPhysicalVfsService,
  createScopedVfsService,
  type VfsScope,
} from '@novel-master/core/vfs';
import { createWorkplaceService } from '@novel-master/core/workplace';
import { createKkvService } from '@novel-master/core/kkv';
import { createSessionKkvService } from '@novel-master/core/session-kkv';
import { createSkillsService } from '@novel-master/core/skills';
import {
  createCompositeSecretStore,
  resolveSkspDriver,
} from '@novel-master/core/sksp';
import { getMobileConnection } from '../db/connection';
import {mobileSkspDriverName} from './mobile-sksp';
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
    db: resolveSkspDriver(mobileSkspDriverName()).createStore(conn),
  });
  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({});

  const eventBus = new SimpleEventBus();
  const compactionConditions = createCompactionConditionsStore(conn);

  const chat = createChatServices(conn, { state, agentRegistry });
  const { projects, sessions, messages, usageStats } = chat;

  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  const { userVfsTurn } = createUserVfsTurnServiceBundle(conn);

  let compactionConditionEvaluator:
    | ReturnType<typeof createCompactionConditionEvaluator>
    | undefined;
  const getOrCreateEvaluator = (): ReturnType<
    typeof createCompactionConditionEvaluator
  > => {
    if (compactionConditionEvaluator == null) {
      compactionConditionEvaluator = createCompactionConditionEvaluator({
        conditionsStore: compactionConditions,
        tokenCounters,
        providerModels: providerBundle.providerModels,
      });
    }
    return compactionConditionEvaluator;
  };
  const lazyCompactionConditionEvaluator: ReturnType<
    typeof createCompactionConditionEvaluator
  > = {
    shouldRequestCompaction(session, evaluation) {
      return getOrCreateEvaluator().shouldRequestCompaction(
        session,
        evaluation,
      );
    },
    getHideStartDepth() {
      return getOrCreateEvaluator().getHideStartDepth();
    },
  };

  setTimeout(() => {
    ensureLlmFetchConfigured();
  }, 0);

  return {
    conn,
    state,
    preferences,
    kkv,
    eventBus,
    compactionConditions,
    compactionConditionEvaluator: lazyCompactionConditionEvaluator,
    agentRegistry,
    abortRegistry,
    streamRegistry,
    tokenCounters,
    projects,
    sessions,
    messages,
    usageStats,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    globalVfs: () => createScopedVfsService(conn, { kind: 'global' }),
    projectVfs: projectId =>
      createScopedVfsService(conn, { kind: 'project', projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, { kind: 'session', projectId, sessionId }),
    globalMetaVfs: () => createScopedVfsService(conn, { kind: 'global-meta' }),
    projectMetaVfs: projectId =>
      createScopedVfsService(conn, { kind: 'project-meta', projectId }),
    physicalVfs: () => createPhysicalVfsService(conn),
    workplace: (scope: VfsScope) => createWorkplaceService(conn, scope),
    skills: () => createSkillsService(conn),
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
