/**
 * Mobile Novel Master runtime types (CLI-equivalent services + KKV).
 *
 * @module runtime/types
 */

import type {
  PersistentPreferences,
  PersistentState,
  TdbcConnection,
} from '@novel-master/core';
import type {
  AgentRegistryService,
} from '@novel-master/core/agent';
import type {
  MessageService,
  MessageTranscriptEffectsService,
  ProjectService,
  SessionService,
  UserVfsTurnService,
  AppendToolTurnBridgeFn,
} from '@novel-master/core/chat';
import type {
  CompactionConditionEvaluator,
  CompactionConditionsStore,
} from '@novel-master/core/compaction';
import type {
  EventOrchestrator,
  EventsConfigStore,
  SimpleEventBus,
} from '@novel-master/core/events';
import type { SecretStore, ModelRequestService, ProviderModelService, ProviderService, TokenCounterRegistry } from '@novel-master/core/provider';
import type { RegexConfigService } from '@novel-master/core/regex';
import type { MessageCheckpointService, SessionFsService } from '@novel-master/core/session-fs';
import type { VfsScope, VfsService } from '@novel-master/core/vfs';
import type { SessionWorktreeSnapshotStore, WorktreeService } from '@novel-master/core/worktree';
import type {KkvService} from '@novel-master/core/kkv';

/** Open connection with domain services (no CLI scope resolver or mock LLM). */
export interface MobileNovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  /** Internal KKV handle for `AppUiPreferences` only — prefer `preferences` / `state`. */
  readonly kkv: KkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  /** hide/show/truncate 消息 transcript 并 markDirty session worktree。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  /** maxSteps 截断后用户确认的 tool turn 桥接 assistant 追加。 */
  readonly appendToolTurnBridge: AppendToolTurnBridgeFn;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
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
  readonly userVfsTurn: UserVfsTurnService;
}
