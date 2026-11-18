/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import {ABORT_KEY, createAbortRegistry, scopeFromController} from '@novel-master/core/abort';
import {AgentServiceFactory, type AgentAbortRegistry} from '@novel-master/core/agent';
import {CompactionFactory, type CompactionConditionEvaluator} from '@novel-master/core/compaction';
import {SimpleEventBus} from '@novel-master/core/events';
import {createChatServices, createMessageTranscriptEffectsService, createUserVfsTurnServiceBundle} from '@novel-master/core/chat';
import {createPersistentPreferences, createPersistentState, createSearchConfigStore} from '@novel-master/core';
import {userVfsUnifiedToolTurnFlag} from '@novel-master/core/feature-flags';
import {createDefaultTokenCounterRegistry} from '@novel-master/core/tokenizer';
import {ProviderServiceFactory} from '@novel-master/core/provider';
import {createSmartSortRuleService} from '@novel-master/core/smart-sort-rule';
import {MessageCheckpointFactory} from '@novel-master/core/message-checkpoint';
import {createSessionFsService} from '@novel-master/core/session-fs';
import {VfsServiceFactory, type VfsScope} from '@novel-master/core/vfs';
import {createWorkplaceService} from '@novel-master/core/workplace';
import {createKkvService} from '@novel-master/core/kkv';
import {createSessionKkvService} from '@novel-master/core/session-kkv';
import {createSkillsService} from '@novel-master/core/skills';
import {SkspFactory, SkspRegistry} from '@novel-master/core/sksp';
import {getMobileConnection} from '../db/connection';
import {Result, AppError} from '@novel-master/core/errors';
import {mobileSkspDriverName} from './mobile-sksp';
import {ensureLlmFetchConfigured} from './setup-llm-fetch';
import {rollbackTimingLog} from '../debug/run-timing';
import {createQuantumYield} from '../services/yield-quantum';
import type {MobileRuntimeCore} from './types';

/**
 * 回滚链分段打点探针（rollback-large-jank Step 1）：__DEV__ 下把 core 各
 * 子步（plan 拉取/事务子步）转投回滚时间轴；生产（__DEV__=false）与
 * desktop/cli（不注入）恒 no-op。detail 拼进单行 label 便于 logcat 过滤。
 */
function mobileRollbackProbe(label: string, detail?: Record<string, number | string>): void {
  let detailText = '';
  if (detail != null) {
    const entries = Object.entries(detail).map(([key, value]) => `${key}=${value}`);
    detailText = ` (${entries.join(' ')})`;
  }
  rollbackTimingLog(`${label}${detailText}`);
}

/**
 * Opens the app DB once and returns service handles aligned with CLI runtime.
 *
 * 返回 MobileRuntimeCore（不含 sessionStreamUnitManager）——该字段由
 * NovelMasterProvider bootstrap 装配（见 runtime/types.ts 字段注释），
 * 构造时经 core 的 createSessionRunStateService(conn) 注入 run 状态
 * 持久层（自动 kick 重启水合）。
 *
 * 失败通道（错误通道迁移四期）：装配期的已知失败（偏好读取）沿 `Result.err`
 * 接力给 bootstrap；连接/驱动等平台异常仍走 reject（bootstrap catch 统一收口）。
 */
export async function createMobileNovelMasterRuntime(): Promise<Result<MobileRuntimeCore, AppError>> {
  const conn = await getMobileConnection();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const unifiedTurnPref = await preferences.getUserVfsUnifiedToolTurn();
  if (!unifiedTurnPref.ok) return Result.err(unifiedTurnPref.error);
  userVfsUnifiedToolTurnFlag.refresh(unifiedTurnPref.value);

  const smartSortRule = createSmartSortRuleService(conn);
  const agentRegistry = AgentServiceFactory.createRegistry(conn, state);
  const abortRegistry = createAbortRegistry();
  // Agent 门面：把 core 的 `(sessionId, AbortController)` 契约适配到泛化 registry
  // 的 `agent:` 命名空间。scope 经 `scopeFromController` 取——与 run 根 scope 共用
  // 同一 WeakMap memoize 实例，不另建缓存 Map（spec §二）。
  const agentAbortRegistry: AgentAbortRegistry = {
    register: (sessionId, controller) => abortRegistry.register(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    tryRegister: (sessionId, controller) => abortRegistry.tryRegister(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    abort: sessionId => abortRegistry.abort(ABORT_KEY.agent(sessionId)),
    unregister: (sessionId, controller) => abortRegistry.unregister(ABORT_KEY.agent(sessionId), scopeFromController(controller)),
    has: sessionId => abortRegistry.has(ABORT_KEY.agent(sessionId)),
  };
  const streamRegistry = AgentServiceFactory.createStreamRegistry();

  const secretStore = SkspFactory.createCompositeSecretStore({
    db: SkspRegistry.resolve(mobileSkspDriverName()).createStore(conn),
  });
  const providerBundle = ProviderServiceFactory.create(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({});
  // search 配置依赖 kkv + secretStore，在两者之后装配。
  const searchConfig = createSearchConfigStore({kkv, secretStore});

  const eventBus = new SimpleEventBus();
  const compactionConditions = CompactionFactory.createConditionsStore(conn);

  // 列表行解析让步（rollback-large-jank Step 2）：mobile 两处装配缝（runtime
  // .messages 链 + 回滚 plan 拉取链）共用 16ms 量子让步——大结果集的
  // content_json JSON.parse 按片执行，JS 线程不再被单次全量解析独占。
  const messageParseYield = createQuantumYield(16);
  const chatDeps = {state, agentRegistry};
  const chatOptions = {yieldFn: messageParseYield};
  const chat = createChatServices(conn, chatDeps, chatOptions);
  const {projects, sessions, messages, usageStats} = chat;

  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  const {userVfsTurn} = createUserVfsTurnServiceBundle(conn);

  let compactionConditionEvaluator: CompactionConditionEvaluator | undefined;
  const getOrCreateEvaluator = (): CompactionConditionEvaluator => {
    if (compactionConditionEvaluator == null) {
      compactionConditionEvaluator = CompactionFactory.createEvaluator({
        conditionsStore: compactionConditions,
        tokenCounters,
        providerModels: providerBundle.providerModels,
      });
    }
    return compactionConditionEvaluator;
  };
  const lazyCompactionConditionEvaluator: CompactionConditionEvaluator = {
    shouldRequestCompaction(session, evaluation) {
      return getOrCreateEvaluator().shouldRequestCompaction(session, evaluation);
    },
    getHideStartDepth() {
      return getOrCreateEvaluator().getHideStartDepth();
    },
  };

  setTimeout(() => {
    ensureLlmFetchConfigured();
  }, 0);

  return Result.ok({
    conn,
    state,
    preferences,
    kkv,
    eventBus,
    compactionConditions,
    compactionConditionEvaluator: lazyCompactionConditionEvaluator,
    agentRegistry,
    abortRegistry,
    agentAbortRegistry,
    streamRegistry,
    searchConfig,
    tokenCounters,
    projects,
    sessions,
    messages,
    usageStats,
    messageTranscriptEffects,
    sessionFs: createSessionFsService(conn, {
      yieldFn: messageParseYield,
      ...(typeof __DEV__ !== 'undefined' && __DEV__ ? {probe: mobileRollbackProbe} : {}),
    }),
    messageCheckpoint: MessageCheckpointFactory.create(conn),
    sessionKkv,
    globalVfs: () => VfsServiceFactory.createScoped(conn, {kind: 'global'}),
    projectVfs: projectId => VfsServiceFactory.createScoped(conn, {kind: 'project', projectId}),
    sessionVfs: (projectId, sessionId) => VfsServiceFactory.createScoped(conn, {kind: 'session', projectId, sessionId}),
    globalMetaVfs: () => VfsServiceFactory.createScoped(conn, {kind: 'global-meta'}),
    projectMetaVfs: projectId => VfsServiceFactory.createScoped(conn, {kind: 'project-meta', projectId}),
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
  });
}
