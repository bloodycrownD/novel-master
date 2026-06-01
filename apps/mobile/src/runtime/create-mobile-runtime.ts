/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import {
  createAgentRegistryService,
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
  createDefaultTokenCounterRegistry,
  createEventOrchestrator,
  createEventsConfigStore,
  createKkvService,
  createMessageService,
  createPersistentPreferences,
  createPersistentState,
  createProjectService,
  createProviderServices,
  createRegexConfigService,
  createScopedVfsService,
  createSessionFsService,
  createSessionService,
  createSessionMacroCache,
  createWorktreeService,
  SimpleEventBus,
  type VfsScope,
} from '@novel-master/core';
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
  const tokenCounters = createDefaultTokenCounterRegistry({
    providers: providerBundle.providerRepo,
    savedModels: providerBundle.savedModelRepo,
  });

  const eventBus = new SimpleEventBus();
  const eventsConfig = createEventsConfigStore(conn);
  const compactionConditions = createCompactionConditionsStore(conn);
  const macroCache = createSessionMacroCache();
  const messages = createMessageService(conn);

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providers: providerBundle.providerRepo,
  });

  const eventOrchestrator = createEventOrchestrator({
    eventsConfig,
    eventBus,
    messages,
    macroCache,
    worktree: s => createWorktreeService(conn, s),
  });

  const agentRegistry = createAgentRegistryService(conn);

  return {
    conn,
    state,
    preferences,
    kkv,
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
    modelSamplingProfiles: providerBundle.modelSamplingProfiles,
    regexConfig,
  };
}
