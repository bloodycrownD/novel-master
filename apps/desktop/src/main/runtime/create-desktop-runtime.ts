/**
 * Desktop runtime: better-sqlite3 + platform SKSP + full Core service wiring.
 * Mirrors create-mobile-runtime.ts; secret store uses SKSP + env composite (CLI parity).
 *
 * @module runtime/create-desktop-runtime
 */
import {
  createAgentAbortRegistry,
  createAgentRegistryService,
  createAgentStreamRegistry,
} from "@novel-master/core/agent";
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
} from "@novel-master/core/compaction";
import {
  createDefaultTokenCounterRegistry,
  createProviderServices,
} from "@novel-master/core/provider";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  createChatServices,
  createMessageTranscriptEffectsService,
  createUserVfsTurnServiceBundle,
} from "@novel-master/core/chat";
import {
  createPersistentPreferences,
  createPersistentState,
  createSearchConfigStore,
} from "@novel-master/core";
import { refreshUserVfsUnifiedToolTurnSnapshot } from "@novel-master/core/feature-flags";
import { createSmartSortRuleService } from "@novel-master/core/smart-sort-rule";
import {
  createMessageCheckpointService,
} from "@novel-master/core/message-checkpoint";
import {
  createSessionFsService,
} from "@novel-master/core/session-fs";
import {
  createPhysicalVfsService,
  createScopedVfsService,
  SqliteVfsRevisionRepository,
  type VfsScope,
} from "@novel-master/core/vfs";
import {
  createWorkplaceService,
} from "@novel-master/core/workplace";
import { createKkvService } from "@novel-master/core/kkv";
import { createSessionKkvService } from "@novel-master/core/session-kkv";
import { createSkillsService } from "@novel-master/core/skills";
import {
  createCompositeSecretStore,
  createEnvSecretStore,
  resolveSkspDriver,
} from "@novel-master/core/sksp";
import { getDesktopConnection } from "./connection.js";
import { getPlatformSkspName } from "./register-platform-drivers.js";
import { resolveDbPath } from "./resolve-db-path.js";
import { ensureLlmFetchConfigured } from "./setup-llm-fetch.js";
import { getDefaultNodeEncoding } from "@novel-master/tokenizer-driver-node";
import type { DesktopNovelMasterRuntime } from "./types.js";

/**
 * 启动跑完后**空闲预热**一次 cl100k 编码表（stream-metrics-native `agile-3`）。
 *
 * 为什么不预热就会卡：兜底计数（「无模型早退 / web·SP 加载失败 / 主路径抛异常」
 * 三条路径）第一次触发时会在 Electron 主进程**同步**建一整张 cl100k WASM 表
 * （实测 185~248ms），期间事件循环阻塞、IPC 排队。这里把它挪到启动之后的空闲
 * 时段先建好。
 *
 * 编码表经 core `encoding-registry` 的 `enc:<encodingName>` 单命名空间收敛
 * （fallback-caliber-align A/B 线）：历史上 `model:` / `enc:` 双命名空间互不命中、
 * 同一张 cl100k 会因按模型名与按编码名各取一次而构造两份——单键化后精确档
 * （gpt-4 / gpt-3.5-turbo 等 cl100k 系模型）与兜底档**共享预热产物这张表**；
 * gpt-4o（o200k）系模型首次精确计数仍会另建自己的表，不在本预热范围。
 *
 * 三条硬约束（执行方不得违反）：
 * ① **try/catch 静默**——预热失败（资产缺失 / WASM 加载异常）绝不影响启动，读数照走
 *    既有降级路径（`countTextWithDefaultEncoding` 返回 `null` → 退回字符折算）；
 * ② **不得阻塞启动**——只挂 `setTimeout`、**不 `await`**，不能把「偶发的一次性卡顿」
 *    换成「启动失败」，那是净负收益；
 * ③ 不许改成同步 `await getDefaultNodeEncoding()`。
 */
function scheduleCl100kEncodingWarmup(): void {
  setTimeout(() => {
    try {
      getDefaultNodeEncoding();
    } catch {
      // 静默吞掉：预热只是「提前把表建好」，失败时兜底路径会自己再试一次。
    }
  }, 0);
}

/**
 * Opens the app DB once and returns service handles aligned with CLI/mobile runtime.
 */
export async function createDesktopNovelMasterRuntime(): Promise<DesktopNovelMasterRuntime> {
  ensureLlmFetchConfigured();
  const conn = await getDesktopConnection();
  const dbPath = resolveDbPath();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const userVfsUnifiedToolTurnEnabled = await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);
  const smartSortRule = createSmartSortRuleService(conn);

  const skspName = getPlatformSkspName();
  const dbStore = resolveSkspDriver(skspName).createStore(conn);
  const envStore =
    process.env.NM_SKSP_DISABLE_ENV === "1"
      ? undefined
      : createEnvSecretStore();
  const secretStore = createCompositeSecretStore({
    db: dbStore,
    env: envStore,
  });
  // search 工具配置：KKV `nm-search` 模块 + SKSP key ref（与 mobile 同构，core 工厂统一逻辑）
  const searchConfig = createSearchConfigStore({ kkv, secretStore });

  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({
    savedModels: providerBundle.savedModelRepo,
  });

  const eventBus = new SimpleEventBus();
  const compactionConditions = createCompactionConditionsStore(conn);
  const agentRegistry = createAgentRegistryService(conn, state);
  const abortRegistry = createAgentAbortRegistry();
  const streamRegistry = createAgentStreamRegistry();

  // 消息列表行解析让步（ic-08B 方案 B）：与 mobile 的 messageParseYield 同款
  // 机制（见 apps/mobile/src/runtime/create-mobile-runtime.ts 装配）——大会话
  // 下搜索/列表的全量行解压 + JSON.parse 按片让步，main 事件循环不再被单次
  // 同步 map 冻结（ic-08）。desktop 侧无 mobile 的 16ms 量子让步模块，用
  // setTimeout(0) 宏任务让步等价达成「片间交还事件循环」。
  const messageParseYield = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));
  const chat = createChatServices(conn, { state, agentRegistry }, {
    yieldFn: messageParseYield,
  });
  const { projects, sessions, messages, usageStats } = chat;
  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  // 存量 contentRef 行的兜底 hydrate 取数用（同 conn 单实例；
  // 回迁完成前保留，回迁后无生产消费方）。
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const { userVfsTurn } = createUserVfsTurnServiceBundle(conn);

  const compactionConditionEvaluator = createCompactionConditionEvaluator({
    conditionsStore: compactionConditions,
    tokenCounters,
    providerModels: providerBundle.providerModels,
  });

  // 启动路径到此已全部走完（下面只是装配返回值），把 cl100k 建表挪到空闲时段，
  // 避免第一次兜底读数在主进程同步阻塞 ~250ms。
  scheduleCl100kEncodingWarmup();

  return {
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
    streamRegistry,
    tokenCounters,
    projects,
    sessions,
    messages,
    usageStats,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    globalVfs: () => createScopedVfsService(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    globalMetaVfs: () => createScopedVfsService(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project-meta", projectId }),
    physicalVfs: () => createPhysicalVfsService(conn),
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
    revisionRepo,
  };
}
