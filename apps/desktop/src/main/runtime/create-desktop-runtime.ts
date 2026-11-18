/**
 * Desktop runtime: better-sqlite3 + platform SKSP + full Core service wiring.
 * Mirrors create-mobile-runtime.ts; secret store uses SKSP + env composite (CLI parity).
 *
 * @module runtime/create-desktop-runtime
 */
import { ABORT_KEY, createAbortRegistry, scopeFromController } from "@novel-master/core/abort";
import { AgentServiceFactory, type AgentAbortRegistry } from "@novel-master/core/agent";
import { CompactionFactory } from "@novel-master/core/compaction";
import { ProviderServiceFactory } from "@novel-master/core/provider";
import { createDefaultTokenCounterRegistry } from "@novel-master/core/tokenizer";
import { SimpleEventBus } from "@novel-master/core/events";
import { createChatServices, createMessageTranscriptEffectsService, createUserVfsTurnServiceBundle } from "@novel-master/core/chat";
import { createPersistentPreferences, createPersistentState, createSearchConfigStore } from "@novel-master/core";
import { userVfsUnifiedToolTurnFlag } from "@novel-master/core/feature-flags";
import { createSmartSortRuleService } from "@novel-master/core/smart-sort-rule";
import { MessageCheckpointFactory } from "@novel-master/core/message-checkpoint";
import { createSessionFsService } from "@novel-master/core/session-fs";
import { VfsServiceFactory, type VfsScope } from "@novel-master/core/vfs";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { createKkvService } from "@novel-master/core/kkv";
import { createSessionKkvService } from "@novel-master/core/session-kkv";
import { createSkillsService } from "@novel-master/core/skills";
import { SkspFactory, SkspRegistry } from "@novel-master/core/sksp";
import { getDesktopConnection } from "./connection.js";
import { getPlatformSkspName } from "./register-platform-drivers.js";
import { resolveDbPath } from "./resolve-db-path.js";
import { ensureLlmFetchConfigured } from "./setup-llm-fetch.js";
import { getDefaultNodeEncoding } from "@novel-master/tokenizer-driver-node";
import type { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import type { DesktopNovelMasterRuntime } from "./types.js";

/**
 * Opens the app DB once and returns service handles aligned with CLI/mobile runtime.
 */
export async function createDesktopNovelMasterRuntime(): Promise<Result<DesktopNovelMasterRuntime, AppError>> {
  ensureLlmFetchConfigured();
  const conn = await getDesktopConnection();
  const dbPath = resolveDbPath();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const unifiedTurnPref = await preferences.getUserVfsUnifiedToolTurn();
  // 已知失败沿 Result 上行（错误通道迁移七期）：singleton 链按 Result 接力，
  // 由各 IPC 消费方经 toIpcResult / formatIpcError 收口，不再走 throw。
  if (!unifiedTurnPref.ok) return Result.err(unifiedTurnPref.error);
  userVfsUnifiedToolTurnFlag.refresh(unifiedTurnPref.value);
  const smartSortRule = createSmartSortRuleService(conn);

  const skspName = getPlatformSkspName();
  if (!skspName.ok) return Result.err(skspName.error);
  const dbStore = SkspRegistry.resolve(skspName.value).createStore(conn);
  const envStore = process.env.NM_SKSP_DISABLE_ENV === "1" ? undefined : SkspFactory.createEnvSecretStore();
  const secretStore = SkspFactory.createCompositeSecretStore({
    db: dbStore,
    env: envStore,
  });
  // search 工具配置：KKV `nm-search` 模块 + SKSP key ref（与 mobile 同构，core 工厂统一逻辑）
  const searchConfig = createSearchConfigStore({ kkv, secretStore });

  const providerBundle = ProviderServiceFactory.create(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({
    savedModels: providerBundle.savedModelRepo,
  });

  const eventBus = new SimpleEventBus();
  const compactionConditions = CompactionFactory.createConditionsStore(conn);
  const agentRegistry = AgentServiceFactory.createRegistry(conn, state);
  // 泛化 registry + Agent 门面（spec §二「实例拓扑」）：门面把 core 的
  // `(sessionId, AbortController)` 契约适配到 `agent:` 命名空间，scope 经
  // `scopeFromController` 取——与 run 根 scope 共用同一 WeakMap memoize 实例，
  // 不另建缓存 Map。两者必须同实例，否则停止按钮与 run 注册各说各话。
  const abortRegistry = createAbortRegistry();
  const agentAbortRegistry: AgentAbortRegistry = {
    register: (sessionId, controller) => abortRegistry.register(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    tryRegister: (sessionId, controller) => abortRegistry.tryRegister(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    abort: (sessionId) => abortRegistry.abort(ABORT_KEY.agent(sessionId)),
    unregister: (sessionId, controller) => abortRegistry.unregister(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    has: (sessionId) => abortRegistry.has(ABORT_KEY.agent(sessionId)),
  };
  const streamRegistry = AgentServiceFactory.createStreamRegistry();

  // 消息列表行解析让步（ic-08B 方案 B）：与 mobile 的 messageParseYield 同款
  // 机制（见 apps/mobile/src/runtime/create-mobile-runtime.ts 装配）——大会话
  // 下搜索/列表的全量行解压 + JSON.parse 按片让步，main 事件循环不再被单次
  // 同步 map 冻结（ic-08）。desktop 侧无 mobile 的 16ms 量子让步模块，用
  // setTimeout(0) 宏任务让步等价达成「片间交还事件循环」。
  const chat = createChatServices(conn, { state, agentRegistry }, { yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)) });
  const { projects, sessions, messages, usageStats } = chat;
  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  const { userVfsTurn } = createUserVfsTurnServiceBundle(conn);

  const compactionConditionEvaluator = CompactionFactory.createEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providerModels: providerBundle.providerModels,
  });

  // 启动路径到此已全部走完（下面只是装配返回值），把 cl100k 建表挪到空闲时段，
  // 避免第一次兜底读数在主进程同步阻塞 ~250ms（stream-metrics-native `agile-3`）。
  // 编码表经 core `encoding-registry` 的 `enc:<encodingName>` 单命名空间收敛：
  // 精确档（gpt-4 / gpt-3.5-turbo 等 cl100k 系模型）与兜底档共享这张预热表；
  // gpt-4o（o200k）系模型首次精确计数仍会另建自己的表，不在本预热范围。
  //
  // 三条硬约束：① try/catch 静默——预热失败绝不影响启动，读数照走既有降级路径；
  // ② 不得阻塞启动——只挂 `setTimeout`、**不 `await`**；③ 不许改成同步 `await getDefaultNodeEncoding()`。
  setTimeout(() => {
    try {
      getDefaultNodeEncoding();
    } catch {
      // 静默吞掉：预热只是「提前把表建好」，失败时兜底路径会自己再试一次。
    }
  }, 0);

  return Result.ok({
    conn,
    dbPath,
    state,
    preferences,
    kkv,
    eventBus,
    compactionConditions,
    compactionConditionEvaluator,
    agentRegistry,
    abortRegistry,
    agentAbortRegistry,
    streamRegistry,
    tokenCounters,
    projects,
    sessions,
    messages,
    usageStats,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: MessageCheckpointFactory.create(conn),
    sessionKkv,
    globalVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global" }),
    projectVfs: (projectId) => VfsServiceFactory.createScoped(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      VfsServiceFactory.createScoped(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    globalMetaVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) => VfsServiceFactory.createScoped(conn, { kind: "project-meta", projectId }),
    physicalVfs: () => VfsServiceFactory.createPhysical(conn),
    workplace: (scope: VfsScope) => createWorkplaceService(conn, scope),
    skills: () => createSkillsService(conn),
    secretStore,
    providers: providerBundle.providers,
    providerModels: providerBundle.providerModels,
    savedModelRepo: providerBundle.savedModelRepo,
    providerRepo: providerBundle.providerRepo,
    modelRequests: providerBundle.modelRequests,
    smartSortRule,
    userVfsTurn,
    searchConfig,
  });
}
