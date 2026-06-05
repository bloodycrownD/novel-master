/**
 * Mobile Novel Master runtime types (CLI-equivalent services + KKV).
 *
 * @module runtime/types
 */

import type {
  AgentRegistryService,
  CompactionConditionEvaluator,
  CompactionConditionsStore,
  EventOrchestrator,
  EventsConfigStore,
  KkvService,
  MessageService,
  ModelRequestService,
  PersistentPreferences,
  PersistentState,
  ProjectService,
  ProviderModelService,
  ProviderService,
  RegexConfigService,
  SecretStore,
  SessionFsService,
  SessionMacroCache,
  SessionService,
  SimpleEventBus,
  TdbcConnection,
  TokenCounterRegistry,
  VfsScope,
  VfsService,
  WorktreeService,
} from '@novel-master/core';

/** Open connection with domain services (no CLI scope resolver or mock LLM). */
export interface MobileNovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly kkv: KkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  readonly sessionFs: SessionFsService;
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
  readonly regexConfig: RegexConfigService;
  readonly agentRegistry: AgentRegistryService;
  readonly tokenCounters: TokenCounterRegistry;
}
