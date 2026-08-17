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
  AgentAbortRegistry,
  AgentRegistryService,
  AgentStreamRegistry,
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
import type { SimpleEventBus } from '@novel-master/core/events';
import type {
  SecretStore,
  ModelRequestService,
  ProviderModelService,
  ProviderService,
  ProviderServiceBundle,
  TokenCounterRegistry,
} from '@novel-master/core/provider';
import type { RegexConfigService } from '@novel-master/core/regex';
import type { MessageCheckpointService } from '@novel-master/core/message-checkpoint';
import type { SessionFsService } from '@novel-master/core/session-fs';
import type { VfsScope, VfsService } from '@novel-master/core/vfs';
import type {
  WorkplaceService,
} from '@novel-master/core/workplace';
import type { KkvService } from '@novel-master/core/kkv';
import type { SessionKkvService } from '@novel-master/core/session-kkv';
import type { SkillService } from '@novel-master/core/skills';

/** Open connection with domain services (no CLI scope resolver or mock LLM). */
export interface MobileNovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  /** Internal KKV handle for `AppUiPreferences` only — prefer `preferences` / `state`. */
  readonly kkv: KkvService;
  /** 会话级规则快照 / file_cache；Agent write upsert 与常驻工作区共用。 */
  readonly sessionKkv: SessionKkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  /** hide/show/truncate 消息 transcript（不 capture worktree 块）。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  /** maxSteps 截断后用户确认的 tool turn 桥接 assistant 追加。 */
  readonly appendToolTurnBridge: AppendToolTurnBridgeFn;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly eventBus: SimpleEventBus;
  readonly compactionConditions: CompactionConditionsStore;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  workplace(scope: VfsScope): WorkplaceService;
  /** 两域技能服务（清单 / 合并视图 / 读写 / 启停 / 复制删除）。 */
  skills(): SkillService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly savedModelRepo: ProviderServiceBundle['savedModelRepo'];
  readonly providerRepo: ProviderServiceBundle['providerRepo'];
  readonly modelRequests: ModelRequestService;
  readonly regexConfig: RegexConfigService;
  readonly agentRegistry: AgentRegistryService;
  /** 按 sessionId 索引 in-flight run 的 controller，供停止按钮 / IPC 中断。 */
  readonly abortRegistry: AgentAbortRegistry;
  /** 按 sessionId 索引 in-flight run 的流句柄，供 IPC 订阅 / 取消订阅。 */
  readonly streamRegistry: AgentStreamRegistry;
  readonly tokenCounters: TokenCounterRegistry;
  readonly userVfsTurn: UserVfsTurnService;
}
