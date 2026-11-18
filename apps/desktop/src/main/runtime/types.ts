/**
 * Desktop Novel Master runtime types (CLI/mobile-equivalent services + dbPath).
 *
 * @module runtime/types
 */
import type {
  PersistentPreferences,
  PersistentState,
  TdbcConnection,
} from "@novel-master/core";
import type { AbortRegistry } from "@novel-master/core/abort";
import type {
  AgentAbortRegistry,
  AgentRegistryService,
  AgentStreamRegistry,
} from "@novel-master/core/agent";
import type {
  MessageService,
  MessageTranscriptEffectsService,
  ProjectService,
  SessionService,
  UsageStatsService,
  UserVfsTurnService,
} from "@novel-master/core/chat";
import type {
  CompactionConditionEvaluator,
  CompactionConditionsStore,
} from "@novel-master/core/compaction";
import type { SimpleEventBus } from "@novel-master/core/events";
import type {
  ModelRequestService,
  ProviderModelService,
  ProviderService,
  ProviderServiceBundle,
} from "@novel-master/core/provider";
import type { SecretStore } from "@novel-master/core/sksp";
import type { TokenCounterRegistry } from "@novel-master/core/tokenizer";
import type { MessageCheckpointService } from "@novel-master/core/message-checkpoint";
import type { SessionFsService } from "@novel-master/core/session-fs";
import type { SmartSortRuleService } from "@novel-master/core/smart-sort-rule";
import type {
  PhysicalVfsService,
  VfsScope,
  VfsService,
} from "@novel-master/core/vfs";
import type { WorkplaceService } from "@novel-master/core/workplace";
import type { KkvService } from "@novel-master/core/kkv";
import type { SessionKkvService } from "@novel-master/core/session-kkv";
import type { SkillService } from "@novel-master/core/skills";
import type { SearchConfigStore } from "@novel-master/core";

/** Open connection with domain services (main-process singleton host). */
export interface DesktopNovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly dbPath: string;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  /** Internal KKV handle for `AppUiPreferences` only — prefer `preferences` / `state`. */
  readonly kkv: KkvService;
  /** 会话级规则快照 / file_cache；Agent write upsert 与常驻工作区共用。 */
  readonly sessionKkv: SessionKkvService;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  /** Token 用量统计（summary / 桶 / 分模型，设置页数据源）。 */
  readonly usageStats: UsageStatsService;
  /** tail 截断 / 置位消息 transcript（不 capture worktree 块；hide/show 直连 messages）。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly eventBus: SimpleEventBus;
  readonly compactionConditions: CompactionConditionsStore;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  /** meta 域（技能存储）：global:meta / project:{pid}:meta。 */
  globalMetaVfs(): VfsService;
  projectMetaVfs(projectId: string): VfsService;
  /** 只读物理树（全局文件浏览器）：跨域拼接只读视图，无任何写方法。 */
  physicalVfs(): PhysicalVfsService;
  workplace(scope: VfsScope): WorkplaceService;
  /** 两域技能服务（清单 / 合并视图 / 读写 / 启停 / 复制删除）。 */
  skills(): SkillService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly savedModelRepo: ProviderServiceBundle["savedModelRepo"];
  readonly providerRepo: ProviderServiceBundle["providerRepo"];
  readonly modelRequests: ModelRequestService;
  /** 智能排序规则管理（列表/增删改/启停/调序/导入导出/预览，设置页数据源）。 */
  readonly smartSortRule: SmartSortRuleService;
  readonly agentRegistry: AgentRegistryService;
  /** 进程内泛化取消注册表：按 `ABORT_KEY` 命名空间索引，长任务 handler 共用。 */
  readonly abortRegistry: AbortRegistry;
  /**
   * Agent 门面：按 sessionId 索引 in-flight run 的 controller，供停止按钮 /
   * core run 端口消费。与 {@link abortRegistry} 是**同一个泛化实例**（内部走
   * `ABORT_KEY.agent` + `scopeFromController`），字段名刻意不同——core 若沿
   * 同名 `abortRegistry` 取用会拿到泛化实例，裸 sessionId 派发永远 miss。
   */
  readonly agentAbortRegistry: AgentAbortRegistry;
  /** 按 sessionId 索引 in-flight run 的流句柄，供 IPC 订阅 / 取消订阅。 */
  readonly streamRegistry: AgentStreamRegistry;
  readonly tokenCounters: TokenCounterRegistry;
  readonly userVfsTurn: UserVfsTurnService;
  /**
   * 搜索引擎配置（search 工具用）：core 工厂包 kkv + secretStore，
   * run-agent-turn 经结构化兼容读取本字段装配 search 闭包。
   */
  readonly searchConfig: SearchConfigStore;
}
