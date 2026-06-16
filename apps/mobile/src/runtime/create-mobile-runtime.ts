/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import { createAgentRegistryService } from '@novel-master/core/agent';
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
  createMessageService,
  createProjectService,
  createSessionService,
  createUserVfsTurnServiceBundle,
} from '@novel-master/core/chat';
import {
  createPersistentPreferences,
  createPersistentState,
} from '@novel-master/core';
import {
  createProviderServices,
  createDefaultTokenCounterRegistry,
} from '@novel-master/core/provider';
import { createRegexConfigService } from '@novel-master/core/regex';
import {
  createMessageCheckpointService,
  createSessionFsService,
} from '@novel-master/core/session-fs';
import {
  createScopedVfsService,
  type VfsScope,
} from '@novel-master/core/vfs';
import {
  createSessionWorktreeSnapshotStore,
  createWorktreeService,
} from '@novel-master/core/worktree';
import {createKkvService} from '@novel-master/core/kkv';
import {createCompositeSecretStore} from '@novel-master/core/sksp';
import {createAndroidSecretStore} from '@novel-master/sksp-android';
import {getMobileConnection} from '../db/connection';
import {ensureLlmFetchConfigured} from './setup-llm-fetch';
import type {MobileNovelMasterRuntime} from './types';

/**
 * Opens the app DB once and returns service handles aligned with CLI runtime.
 */
export async function createMobileNovelMasterRuntime(): Promise<MobileNovelMasterRuntime> {
  ensureLlmFetchConfigured();
  const conn = await getMobileConnection();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const regexConfig = createRegexConfigService(conn, state);

  const secretStore = createCompositeSecretStore({
    db: createAndroidSecretStore(conn),
  });

  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({});

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);
  const worktreeSnapshot = createSessionWorktreeSnapshotStore();
  const messages = createMessageService(conn);
  const {userVfsTurn, appendToolTurnBridge} = createUserVfsTurnServiceBundle(conn);

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providerModels: providerBundle.providerModels,
  });

  const agentRegistry = createAgentRegistryService(conn);

  const eventOrchestrator = createEventOrchestrator({
    eventsConfig,
    eventBus,
    messages,
    worktreeSnapshot,
    worktree: s => createWorktreeService(conn, s),
    runAgent: createRunAgentHandlerDeps({
      messages,
      agentRegistry,
      modelRequests: providerBundle.modelRequests,
      worktreeSnapshot,
      worktree: s => createWorktreeService(conn, s),
      sessionVfs: (projectId, sessionId) =>
        createScopedVfsService(conn, {kind: 'session', projectId, sessionId}),
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
    kkv,
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
    appendToolTurnBridge,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    globalVfs: () => createScopedVfsService(conn, {kind: 'global'}),
    projectVfs: projectId =>
      createScopedVfsService(conn, {kind: 'project', projectId}),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {kind: 'session', projectId, sessionId}),
    worktree: (scope: VfsScope) => createWorktreeService(conn, scope),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    modelRequests: providerBundle.modelRequests,
    regexConfig,
    userVfsTurn,
  };
}
