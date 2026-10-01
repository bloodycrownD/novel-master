/**
 * Shared Novel Master CLI runtime (DB open + service factories).
 *
 * @module runtime
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerTokenizerNodeDriver } from "@novel-master/tokenizer-driver-node";
import { bootstrapNovelMaster, createPersistentPreferences, createPersistentState, open, runBlobBinaryNormalization, runMessageContentDecompress, runMessageRefUnref, type PersistentPreferences, type PersistentState, type TdbcConnection } from "@novel-master/core";
import { refreshUserVfsUnifiedToolTurnSnapshot } from "@novel-master/core/feature-flags";

import { createAgentRegistryService, createAgentStreamRegistry, createAgentAbortRegistry } from "@novel-master/core/agent";
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
  type CompactionConditionEvaluator,
  type CompactionConditionsStore,
} from "@novel-master/core/compaction";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  createMessageService,
  createMessageTranscriptEffectsService,
  createProjectService,
  createSessionService,
  createUserVfsTurnServiceBundle,
  type MessageService,
  type MessageTranscriptEffectsService,
  type ProjectService,
  type SessionService,
  type UserVfsTurnService,
} from "@novel-master/core/chat";
import {
  createProviderServices,
  createDefaultTokenCounterRegistry,
  type ModelRequestService,
  type ProviderModelService,
  type ProviderService,
  type ProviderServiceBundle,
  type SecretStore,
  type TokenCounterRegistry,
} from "@novel-master/core/provider";
import {
  createSmartSortRuleService,
  type SmartSortRuleService,
} from "@novel-master/core/smart-sort-rule";
import { createMessageCheckpointService, type MessageCheckpointService } from "@novel-master/core/message-checkpoint";
import {
  createSessionFsService,
  type SessionFsService,
} from "@novel-master/core/session-fs";
import {
  createPhysicalVfsService,
  createScopedVfsService,
  SqliteVfsRevisionRepository,
  type PhysicalVfsService,
  type VfsRevisionRepository,
  type VfsScope,
  type VfsService,
} from "@novel-master/core/vfs";
import {
  createWorkplaceService,
  type WorkplaceService,
} from "@novel-master/core/workplace";
import {
  createSessionKkvService,
  type SessionKkvService,
} from "@novel-master/core/session-kkv";
import { createSkillsService, type SkillService } from "@novel-master/core/skills";
import type { AgentAbortRegistry, AgentRegistryService, AgentStreamRegistry } from "@novel-master/core/agent";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import {
  createCompositeSecretStore,
  createEnvSecretStore,
  resolveSkspDriver,
  resolveSkspNameFromPlatform,
  type PlatformSkspName,
} from "@novel-master/core/sksp";
import { registerSkspMacDriver } from "@novel-master/sksp-mac";
import { registerSkspWindowsDriver } from "@novel-master/sksp-windows";
import { registerSkspLinuxDriver } from "@novel-master/sksp-linux";
import { createAgentMockModelRequests } from "./agent/mock-llm.js";
import { installE2eLlmFetchCapture } from "./test/e2e-llm-fetch.js";
import { CliScopeResolver } from "./config/resolve-scope.js";
import { extractDbPath } from "./vfs/parse-args.js";

const DEFAULT_DB = "./.novel-master/novel.db";

/**
 * 根据当前进程平台注册对应的 SKSP driver，并返回其注册名。
 *
 * 之所以显式走 `resolveSkspNameFromPlatform`，而不是直接写死 `"windows"`，
 * 是因为之前 macOS/Linux 上跑 CLI 时会静默落到 windows driver，行为不对。
 * 现在改成：darwin→macos、win32→windows、linux→linux，其它平台抛错——
 * 这样无 driver 的平台会在启动早期就明确报错，而不是悄悄用错驱动。
 */
export function registerPlatformSkspDriver(
  platform: string = process.platform,
): PlatformSkspName {
  const name = resolveSkspNameFromPlatform(platform);
  if (name === "macos") {
    registerSkspMacDriver();
  } else if (name === "linux") {
    registerSkspLinuxDriver();
  } else {
    registerSkspWindowsDriver();
  }
  return name;
}

/**
 * Resolves database file path: NOVEL_MASTER_DB > --db > default.
 */
export function resolveDbPath(argv: readonly string[]): string {
  if (process.env.NOVEL_MASTER_DB) {
    return process.env.NOVEL_MASTER_DB;
  }
  const fromFlag = extractDbPath(argv).dbPath;
  if (fromFlag != null) {
    return fromFlag;
  }
  return DEFAULT_DB;
}

/** Open connection with all domain services wired. */
export interface NovelMasterRuntime {
  readonly conn: TdbcConnection;
  readonly state: PersistentState;
  readonly preferences: PersistentPreferences;
  readonly projects: ProjectService;
  readonly sessions: SessionService;
  readonly messages: MessageService;
  /** hide/show/truncate 消息 transcript（不 capture worktree 块）。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  readonly sessionFs: SessionFsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly scope: CliScopeResolver;
  readonly eventBus: SimpleEventBus;
  readonly compactionConditions: CompactionConditionsStore;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  globalVfs(): VfsService;
  projectVfs(projectId: string): VfsService;
  sessionVfs(projectId: string, sessionId: string): VfsService;
  /** 只读物理树（全局文件浏览器）：跨域拼接只读视图，无任何写方法。 */
  physicalVfs(): PhysicalVfsService;
  workplace(scope: VfsScope): WorkplaceService;
  /** 两域技能服务（清单 / 合并视图 / 读写 / 启停 / 复制删除）。 */
  skills(): SkillService;
  readonly secretStore: SecretStore;
  readonly providers: ProviderService;
  readonly providerModels: ProviderModelService;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: ProviderServiceBundle["savedModelRepo"];
  /** {@link AgentTurnRuntimePort} 别名；与 savedModels 同源。 */
  readonly savedModelRepo: ProviderServiceBundle["savedModelRepo"];
  readonly providerRepo: ProviderServiceBundle["providerRepo"];
  /** 用户 VFS U-A-U-A 落库；runAgentTurn flush 前置。 */
  readonly userVfsTurn: UserVfsTurnService;
  /** 会话级规则快照 / file_cache；Agent write upsert 与常驻工作区共用。 */
  readonly sessionKkv: SessionKkvService;
  /**
   * 存量 contentRef 行的兜底 hydrate 取数用（回迁完成前保留，
   * 回迁后无生产消费方）。
   */
  readonly revisionRepo: VfsRevisionRepository;
  /** 智能排序规则管理（sort-rule 命令组与 workplace smart 排序共用）。 */
  readonly smartSortRule: SmartSortRuleService;
  readonly agentRegistry: AgentRegistryService;
  /**
   * Agent abort registry：按 sessionId 索引在途 run 的 controller。
   *
   * D6（CLI 补注入）：此前 CLI 不注入、`runAgentTurn` 走
   * `abortRegistry?.register(...)` 空安全分支——后果是 task `sessionId`
   * 续用子会话的并发硬互斥闭包 `runtime.abortRegistry?.has(id) ?? true`
   * 永远走保守拒绝分支（在途判据恒真、续用能力形同虚设）。补注入后三端
   * 判据同源，生产路径不再命中那个缺 registry 的降级分支。
   */
  readonly abortRegistry: AgentAbortRegistry;
  /** 按 sessionId 索引 in-flight run 的流句柄，供订阅 / 取消订阅。 */
  readonly streamRegistry: AgentStreamRegistry;
  readonly tokenCounters: TokenCounterRegistry;
  readonly dbPath: string;
}

/**
 * Opens SQLite, bootstraps full schema, and returns service handles.
 */
export async function createNovelMasterRuntime(
  argv: readonly string[],
): Promise<NovelMasterRuntime> {
  registerBetterSqlite3Driver();
  const skspName = registerPlatformSkspDriver();
  registerTokenizerNodeDriver();
  const dbPath = resolve(resolveDbPath(argv));
  await mkdir(dirname(dbPath), { recursive: true });

  const conn = await open(`tdbc:sqlite:file:${dbPath}`, {
    driver: "better-sqlite3",
  });
  await bootstrapNovelMaster(conn);
  // 双任务预算：解压 5s + 归一 60s、最坏合计约 65s。解压只给 5s 是因为
  // CLI 是三端唯一把搬运 await 进命令关键路径的（desktop/mobile 皆
  // fire-and-forget），交互式进程不该被一次搬运独占一分钟；超预算残余由
  // 下次命令或双端启动续跑。顺序无功能依赖——解压谓词（content_blob IS
  // NOT NULL）与归一谓词（blob 形态）可交叠但收敛顺序无关：任一先跑，
  // 另一谓词重扫后自然收敛。
  await runMessageContentDecompress(conn, { syncBudgetMs: 5_000 });
  // 引用化回迁（存量 contentRef 行 → 明文包 + 源 revision 精确 −1）：同样
  // 内联 await 进 CLI 启动、同样 5s 预算（交互式进程不该被一次搬运独占）。
  // 与解压/归一谓词可交叠、收敛顺序无关：解压谓词是 content_blob IS NOT
  // NULL、回迁谓词在其补集上（content_blob IS NULL），两者互不覆盖；回迁
  // 收尾若发现解压标记未置会返回 deferred，本次不置标记，等解压置标记后由
  // 下次命令续跑（幂等）。
  await runMessageRefUnref(conn, { syncBudgetMs: 5_000 });
  // 存量 blob 形态归一（zlib-b64 文本 → 二进制 BLOB）：幂等可重入；收尾
  // 维护仅在本轮确有推进（成功改写 ≥1 行）且全部表完成时触发一次（稳态
  // 零成本短路），上一轮维护失败由持久化标记 startupMaintenancePending 补跑。
  await runBlobBinaryNormalization(conn);

  const state = createPersistentState(conn);
  const smartSortRule = createSmartSortRuleService(conn);
  const preferences = createPersistentPreferences(conn);
  const userVfsUnifiedToolTurnEnabled = await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);
  const scope = new CliScopeResolver(state);

  const dbStore = resolveSkspDriver(skspName).createStore(conn);
  const envStore =
    process.env.NM_SKSP_DISABLE_ENV === "1"
      ? undefined
      : createEnvSecretStore();
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: envStore,
  });
  if (process.env.NM_LLM_E2E_FETCH === "1" && process.env.NM_AGENT_MOCK_LLM !== "1") {
    installE2eLlmFetchCapture();
  }
  const providerBundle = createProviderServices(conn, secretStore);
  const modelRequests =
    process.env.NM_AGENT_MOCK_LLM === "1"
      ? createAgentMockModelRequests()
      : providerBundle.modelRequests;

  const tokenCounters = createDefaultTokenCounterRegistry({});

  const eventBus = new SimpleEventBus();
  const compactionConditions = createCompactionConditionsStore(conn);
  const messages = createMessageService(conn);
  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  // 存量 contentRef 行的兜底 hydrate 取数用（同 conn 单实例；回迁完成前保留，回迁后无生产消费方）。
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const { userVfsTurn } = createUserVfsTurnServiceBundle(conn);

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providerModels: providerBundle.providerModels,
  });

  const agentRegistry = createAgentRegistryService(conn, state);
  const streamRegistry = createAgentStreamRegistry();
  // D6：进程内单例（Map 薄封装），runAgentTurn 入口即注册 controller。
  const abortRegistry = createAgentAbortRegistry();

  return {
    conn,
    state,
    preferences,
    dbPath,
    eventBus,
    compactionConditions,
    compactionConditionEvaluator,
    agentRegistry,
    streamRegistry,
    abortRegistry,
    tokenCounters,
    projects: createProjectService(conn),
    sessions: createSessionService(conn, { state, agentRegistry }),
    messages,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    revisionRepo,
    scope,
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    physicalVfs: () => createPhysicalVfsService(conn),
    workplace: (scope) => createWorkplaceService(conn, scope),
    skills: () => createSkillsService(conn),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    modelRequests,
    savedModels: providerBundle.savedModelRepo,
    savedModelRepo: providerBundle.savedModelRepo,
    providerRepo: providerBundle.providerRepo,
    userVfsTurn,
    smartSortRule,
  };
}
