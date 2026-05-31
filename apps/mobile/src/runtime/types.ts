/**
 * Mobile Novel Master runtime types (CLI-equivalent services + KKV).
 *
 * @module runtime/types
 */

import type {
  AgentRegistryService,
  CompactionAgentResolver,
  CompactionPolicyStore,
  KkvService,
  MessageService,
  ModelRequestService,
  ModelSamplingProfileService,
  PersistentPreferences,
  PersistentState,
  ProjectService,
  ProviderModelService,
  ProviderService,
  RegexConfigService,
  SecretStore,
  SessionFsService,
  SessionService,
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
  readonly compactionPolicy: CompactionPolicyStore;
  readonly agentRegistry: AgentRegistryService;
  readonly resolveCompactionAgent: CompactionAgentResolver;
  readonly tokenCounters: TokenCounterRegistry;
}
