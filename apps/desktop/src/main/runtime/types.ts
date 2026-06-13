/**
 * Desktop Novel Master runtime types (CLI/mobile-equivalent services + dbPath).
 *
 * @module runtime/types
 */
import type {
  AgentRegistryService,
  CompactionConditionEvaluator,
  CompactionConditionsStore,
  EventOrchestrator,
  EventsConfigStore,
  MessageCheckpointService,
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
  SessionWorktreeSnapshotStore,
  SessionService,
  SimpleEventBus,
  TdbcConnection,
  TokenCounterRegistry,
  VfsScope,
  VfsService,
  WorktreeService,
} from "@novel-master/core";
import type { KkvService } from "@novel-master/core/kkv";

/** Open connection with domain services (main-process singleton host). */
export interface DesktopNovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly dbPath: string;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  /** Internal KKV handle for `AppUiPreferences` only — prefer `preferences` / `state`. */
  readonly kkv: KkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
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
}
