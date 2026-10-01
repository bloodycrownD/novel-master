/**
 * Mobile runtime: RN SQLite + SKSP Android + full Core service wiring.
 *
 * @module runtime/create-mobile-runtime
 */

import {
  createAgentAbortRegistry,
  createAgentRegistryService,
  createAgentStreamRegistry,
} from '@novel-master/core/agent';
import {
  createCompactionConditionEvaluator,
  createCompactionConditionsStore,
} from '@novel-master/core/compaction';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  createChatServices,
  createMessageTranscriptEffectsService,
  createUserVfsTurnServiceBundle,
} from '@novel-master/core/chat';
import {
  createPersistentPreferences,
  createPersistentState,
  createSearchConfigStore,
} from '@novel-master/core';
import {refreshUserVfsUnifiedToolTurnSnapshot} from '@novel-master/core/feature-flags';
import {
  createProviderServices,
  createDefaultTokenCounterRegistry,
} from '@novel-master/core/provider';
import {createSmartSortRuleService} from '@novel-master/core/smart-sort-rule';
import {createMessageCheckpointService} from '@novel-master/core/message-checkpoint';
import {createSessionFsService} from '@novel-master/core/session-fs';
import {
  createPhysicalVfsService,
  createScopedVfsService,
  SqliteVfsRevisionRepository,
  type VfsScope,
} from '@novel-master/core/vfs';
import {createWorkplaceService} from '@novel-master/core/workplace';
import {createKkvService} from '@novel-master/core/kkv';
import {createSessionKkvService} from '@novel-master/core/session-kkv';
import {createSkillsService} from '@novel-master/core/skills';
import {
  createCompositeSecretStore,
  resolveSkspDriver,
} from '@novel-master/core/sksp';
import {getMobileConnection} from '../db/connection';
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
function mobileRollbackProbe(
  label: string,
  detail?: Record<string, number | string>,
): void {
  const detailText =
    detail == null
      ? ''
      : ` (${Object.entries(detail)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ')})`;
  rollbackTimingLog(`${label}${detailText}`);
}

/**
 * Opens the app DB once and returns service handles aligned with CLI runtime.
 *
 * 返回 MobileRuntimeCore（不含 sessionStreamUnitManager）——该字段由
 * NovelMasterProvider bootstrap 装配（见 runtime/types.ts 字段注释），
 * 构造时经 core 的 createSessionRunStateService(conn) 注入 run 状态
 * 持久层（自动 kick 重启水合）。
 */
export async function createMobileNovelMasterRuntime(): Promise<MobileRuntimeCore> {
  const conn = await getMobileConnection();

  const state = createPersistentState(conn);
  const kkv = createKkvService(conn);
  const preferences = createPersistentPreferences(conn);
  const userVfsUnifiedToolTurnEnabled =
    await preferences.getUserVfsUnifiedToolTurn();
  refreshUserVfsUnifiedToolTurnSnapshot(userVfsUnifiedToolTurnEnabled);

  const smartSortRule = createSmartSortRuleService(conn);
  const agentRegistry = createAgentRegistryService(conn, state);
  const abortRegistry = createAgentAbortRegistry();
  const streamRegistry = createAgentStreamRegistry();

  const secretStore = createCompositeSecretStore({
    db: resolveSkspDriver(mobileSkspDriverName()).createStore(conn),
  });
  const providerBundle = createProviderServices(conn, secretStore);
  const tokenCounters = createDefaultTokenCounterRegistry({});
  // search 配置依赖 kkv + secretStore，在两者之后装配。
  const searchConfig = createSearchConfigStore({kkv, secretStore});

  const eventBus = new SimpleEventBus();
  const compactionConditions = createCompactionConditionsStore(conn);

  // 列表行解析让步（rollback-large-jank Step 2）：mobile 两处装配缝（runtime
  // .messages 链 + 回滚 plan 拉取链）共用 16ms 量子让步——大结果集的
  // content_json JSON.parse 按片执行，JS 线程不再被单次全量解析独占。
  const messageParseYield = createQuantumYield(16);
  const chat = createChatServices(conn, {state, agentRegistry}, {
    yieldFn: messageParseYield,
  });
  const {projects, sessions, messages, usageStats} = chat;

  const messageTranscriptEffects = createMessageTranscriptEffectsService(conn);
  const sessionKkv = createSessionKkvService(conn);
  // read 引用化（read-tool-result-ref Step 6）：同 conn 单实例——runAgentTurn
  // 装配点由它推导 read +1 通道，prepare/parity 链用它 hydrate 引用块。
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const {userVfsTurn} = createUserVfsTurnServiceBundle(conn);

  let compactionConditionEvaluator:
    | ReturnType<typeof createCompactionConditionEvaluator>
    | undefined;
  const getOrCreateEvaluator = (): ReturnType<
    typeof createCompactionConditionEvaluator
  > => {
    if (compactionConditionEvaluator == null) {
      compactionConditionEvaluator = createCompactionConditionEvaluator({
        conditionsStore: compactionConditions,
        tokenCounters,
        providerModels: providerBundle.providerModels,
      });
    }
    return compactionConditionEvaluator;
  };
  const lazyCompactionConditionEvaluator: ReturnType<
    typeof createCompactionConditionEvaluator
  > = {
    shouldRequestCompaction(session, evaluation) {
      return getOrCreateEvaluator().shouldRequestCompaction(
        session,
        evaluation,
      );
    },
    getHideStartDepth() {
      return getOrCreateEvaluator().getHideStartDepth();
    },
  };

  setTimeout(() => {
    ensureLlmFetchConfigured();
  }, 0);

  return {
    conn,
    state,
    preferences,
    kkv,
    eventBus,
    compactionConditions,
    compactionConditionEvaluator: lazyCompactionConditionEvaluator,
    agentRegistry,
    abortRegistry,
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
      ...(typeof __DEV__ !== 'undefined' && __DEV__
        ? {probe: mobileRollbackProbe}
        : {}),
    }),
    messageCheckpoint: createMessageCheckpointService(conn),
    sessionKkv,
    globalVfs: () => createScopedVfsService(conn, {kind: 'global'}),
    projectVfs: projectId =>
      createScopedVfsService(conn, {kind: 'project', projectId}),
    sessionVfs: (projectId, sessionId) =>
      createScopedVfsService(conn, {kind: 'session', projectId, sessionId}),
    globalMetaVfs: () => createScopedVfsService(conn, {kind: 'global-meta'}),
    projectMetaVfs: projectId =>
      createScopedVfsService(conn, {kind: 'project-meta', projectId}),
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
    revisionRepo,
  };
}
