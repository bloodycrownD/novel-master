/**
 * 数据库维护（数据清理）mobile 服务：库体积/可回收量统计与清理执行入口。
 *
 * 清理执行链在 core `DbMaintenance.create`（缓存 GC → 防御性
 * checkpoint → VACUUM，事务外、驱动层互斥串行）；本服务只补 mobile 侧
 * 事情——Agent 运行守卫与数据库文件体积采样（blob-util stat）。
 * 错误口径：Agent 运行中守卫沿 `Result.err` 上行（错误通道迁移五期）；
 * 其余平台异常（blobFs stat 等）仍以 reject 上抛（由调用方 catch 收口）。
 *
 * 存量 blob 归一与 VFS 历史版本打包两个后台搬运任务的状态透传已随
 * 第七轮退役删除（v1.5.41 同批，任务本体一并出列）。
 *
 * @module services/db-maintenance.service
 */
import {DbMaintenance} from '@novel-master/core';
import {AppError} from '@novel-master/core/errors';
import {ABORT_KEY, AbortScopeFactory} from '@novel-master/core/abort';
import {assert} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';
import {MobileDatabaseFilePath} from '../db/db-file-path';
import {agentActivity} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {blobFs} from './rn-file-io';
import {maintenanceBusy} from './db-maintenance-busy';

/** 数据库文件体积采样（blob-util stat 的 size 为字符串，统一转 number）。 */
async function statDatabaseFileBytes(): Promise<number> {
  const dbPath = await MobileDatabaseFilePath.resolve();
  const info = await blobFs().stat(dbPath);
  return Number(info.size);
}

/**
 * 采样当前存储统计：数据库文件体积 + VACUUM 理论可回收量（只读 PRAGMA）。
 *
 * 仅用于展示，Agent 运行中抛中文 Error，由调用方决定静默或提示。
 */
export async function getDbMaintenanceStats(runtime: MobileNovelMasterRuntime): Promise<Result<{fileBytes: number; reclaimableBytes: number}, AppError>> {
  if (agentActivity.isActive()) {
    return Result.err(new AppError('AGENT_BUSY', {detail: 'Agent 运行中，请稍后再操作'}));
  }
  const [fileBytes, stats] = await Promise.all([statDatabaseFileBytes(), DbMaintenance.create(runtime.conn).getStorageStats()]);
  return Result.ok({
    fileBytes,
    reclaimableBytes: stats.reclaimableBytes,
  });
}

/**
 * 执行数据清理（缓存 GC → checkpoint → VACUUM），返回前后文件体积。
 * VACUUM 耗时随库体积增长（大库数十秒）；期间计数式置 busy——后台搬运
 * 循环据此让路（与数据清理互斥）。
 */
export async function runDbMaintenance(runtime: MobileNovelMasterRuntime): Promise<Result<{beforeBytes: number; afterBytes: number}, AppError>> {
  if (agentActivity.isActive()) {
    return Result.err(new AppError('AGENT_BUSY', {detail: 'Agent 运行中，请稍后再操作'}));
  }
  // 任务级取消 scope（spec §五移动表：dbMaintenance("local")，**仅入口**；
  // VACUUM / checkpoint 同步段不可中断，UI 不提供取消按钮）。
  const abortScope = AbortScopeFactory.buildScope({});
  runtime.abortRegistry.register(ABORT_KEY.dbMaintenance('local'), abortScope);
  try {
    // 本入口没有任何取消来源（UI 不提供取消按钮，registry 也没人 abort）；
    // 命中即不变量破坏，断言而非取消语义。
    assert(abortScope.checkpoint() == null, 'runDbMaintenance 未接入取消来源，入口检查点不应命中');
    maintenanceBusy.acquire();
    try {
      const beforeBytes = await statDatabaseFileBytes();
      await DbMaintenance.create(runtime.conn).runDatabaseMaintenance();
      const afterBytes = await statDatabaseFileBytes();
      return Result.ok({beforeBytes, afterBytes});
    } finally {
      maintenanceBusy.release();
    }
  } finally {
    runtime.abortRegistry.unregister(ABORT_KEY.dbMaintenance('local'), abortScope);
    abortScope.dispose();
  }
}
