/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import {ABORT_KEY, AbortRegistryFactory, AbortScopeFactory} from '@novel-master/core/abort';
import {AgentServiceFactory, type AgentAbortRegistry} from '@novel-master/core/agent';
import {CompactionFactory, type CompactionConditionEvaluator} from '@novel-master/core/compaction';
import {SimpleEventBus} from '@novel-master/core/events';
import {ChatServiceFactory} from '@novel-master/core/chat';
import {createPersistentPreferences, PersistentStateFactory, SearchConfig} from '@novel-master/core';
import {userVfsUnifiedToolTurnFlag} from '@novel-master/core/feature-flags';
import {DefaultTokenCounterRegistry} from '@novel-master/core/tokenizer';
import {ProviderServiceFactory} from '@novel-master/core/provider';
import {SmartSortRuleServiceFactory} from '@novel-master/core/smart-sort-rule';
import {MessageCheckpointFactory} from '@novel-master/core/message-checkpoint';
import {SessionFsServiceFactory} from '@novel-master/core/session-fs';
import {VfsServiceFactory, type VfsScope} from '@novel-master/core/vfs';
import {WorkplaceServiceFactory} from '@novel-master/core/workplace';
import {createKkvService} from '@novel-master/core/kkv';
import {SessionKkvServiceFactory} from '@novel-master/core/session-kkv';
import {SkillsServiceFactory} from '@novel-master/core/skills';
import {SkspFactory, SkspRegistry} from '@novel-master/core/sksp';
import {MobileDb} from '../db/connection';
import {Result, AppError} from '@novel-master/core/errors';
import {MobileSksp} from './mobile-sksp';
import {LlmFetchSetup} from './setup-llm-fetch';
import {rollbackTimingLog} from '../debug/run-timing';
import {YieldQuantum} from '../services/yield-quantum';
import type {MobileRuntimeCore} from './types';

export const MobileRuntimeFactory = {
  /**
   * 回滚链分段打点探针（rollback-large-jank Step 1）：__DEV__ 下把 core 各
   * 子步（plan 拉取/事务子步）转投回滚时间轴；生产（__DEV__=false）与
   * desktop/cli（不注入）恒 no-op。detail 拼进单行 label 便于 logcat 过滤。
   */
  mobileRollbackProbe: (label: string, detail?: Record<string, number | string>): void => {
    let detailText = '';
    if (detail != null) {
      const entries = Object.entries(detail).map(([key, value]) => `${key}=${value}`);
      detailText = ` (${entries.join(' ')})`;
    }
    rollbackTimingLog(`${label}${detailText}`);
  },

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
  // nm-style: keep-public — 115 行 runtime 装配 IO 管线（DB 连接 + 20+ core 服务接线 + lazy evaluator + fetch 装配调度）；模块即装配层，内联会把管线塞进 React provider
  create: async (): Promise<Result<MobileRuntimeCore, AppError>> => {
    const conn = await MobileDb.getMobileConnection();

    const state = PersistentStateFactory.create(conn);
    const kkv = createKkvService(conn);
    const preferences = createPersistentPreferences(conn);
    const unifiedTurnPref = await preferences.getUserVfsUnifiedToolTurn();
    if (!unifiedTurnPref.ok) return Result.err(unifiedTurnPref.error);
    userVfsUnifiedToolTurnFlag.refresh(unifiedTurnPref.value);

    const smartSortRule = SmartSortRuleServiceFactory.create(conn);
    const agentRegistry = AgentServiceFactory.createRegistry(conn, state);
    const abortRegistry = AbortRegistryFactory.create();
    // Agent 门面：把 core 的 `(sessionId, AbortController)` 契约适配到泛化 registry
    // 的 `agent:` 命名空间。scope 经 `AbortScopeFactory.fromController` 取——与 run 根 scope 共用
    // 同一 WeakMap memoize 实例，不另建缓存 Map（spec §二）。
    const agentAbortRegistry: AgentAbortRegistry = {
      register: (sessionId, controller) => abortRegistry.register(ABORT_KEY.agent(sessionId), AbortScopeFactory.fromController(controller)),
      tryRegister: (sessionId, controller) => abortRegistry.tryRegister(ABORT_KEY.agent(sessionId), AbortScopeFactory.fromController(controller)),
      abort: sessionId => abortRegistry.abort(ABORT_KEY.agent(sessionId)),
      unregister: (sessionId, controller) => abortRegistry.unregister(ABORT_KEY.agent(sessionId), AbortScopeFactory.fromController(controller)),
      has: sessionId => abortRegistry.has(ABORT_KEY.agent(sessionId)),
    };
    const streamRegistry = AgentServiceFactory.createStreamRegistry();

    const secretStore = SkspFactory.createCompositeSecretStore({
      db: SkspRegistry.resolve(MobileSksp.driverName()).createStore(conn),
    });
    const providerBundle = ProviderServiceFactory.create(conn, secretStore);
    const tokenCounters = DefaultTokenCounterRegistry.create({});
    // search 配置依赖 kkv + secretStore，在两者之后装配。
    const searchConfig = SearchConfig.createStore({kkv, secretStore});

    const eventBus = new SimpleEventBus();
    const compactionConditions = CompactionFactory.createConditionsStore(conn);

    // 列表行解析让步（rollback-large-jank Step 2）：mobile 两处装配缝（runtime
    // .messages 链 + 回滚 plan 拉取链）共用 16ms 量子让步——大结果集的
    // content_json JSON.parse 按片执行，JS 线程不再被单次全量解析独占。
    const messageParseYield = YieldQuantum.create(16);
    const chatDeps = {state, agentRegistry};
    const chatOptions = {yieldFn: messageParseYield};
    const chat = ChatServiceFactory.createBundle(conn, chatDeps, chatOptions);
    const {projects, sessions, messages, usageStats} = chat;

    const messageTranscriptEffects = ChatServiceFactory.createMessageTranscriptEffects(conn);
    const sessionKkv = SessionKkvServiceFactory.create(conn);
    const {userVfsTurn} = ChatServiceFactory.createUserVfsTurnBundle(conn);

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
      LlmFetchSetup.ensureConfigured();
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
      sessionFs: SessionFsServiceFactory.create(conn, {
        yieldFn: messageParseYield,
        ...(typeof __DEV__ !== 'undefined' && __DEV__ ? {probe: MobileRuntimeFactory.mobileRollbackProbe} : {}),
      }),
      messageCheckpoint: MessageCheckpointFactory.create(conn),
      sessionKkv,
      globalVfs: () => VfsServiceFactory.createScoped(conn, {kind: 'global'}),
      projectVfs: projectId => VfsServiceFactory.createScoped(conn, {kind: 'project', projectId}),
      sessionVfs: (projectId, sessionId) => VfsServiceFactory.createScoped(conn, {kind: 'session', projectId, sessionId}),
      globalMetaVfs: () => VfsServiceFactory.createScoped(conn, {kind: 'global-meta'}),
      projectMetaVfs: projectId => VfsServiceFactory.createScoped(conn, {kind: 'project-meta', projectId}),
      physicalVfs: () => VfsServiceFactory.createPhysical(conn),
      workplace: (scope: VfsScope) => WorkplaceServiceFactory.create(conn, scope),
      skills: () => SkillsServiceFactory.create(conn),
      secretStore,
      providers: providerBundle.providers,
      providerModels: providerBundle.providerModels,
      savedModelRepo: providerBundle.savedModelRepo,
      providerRepo: providerBundle.providerRepo,
      modelRequests: providerBundle.modelRequests,
      smartSortRule,
      userVfsTurn,
    });
  },
} as const;
