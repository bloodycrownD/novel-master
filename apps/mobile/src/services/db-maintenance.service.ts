/**
 * 数据库维护（数据清理）mobile 服务：库体积/可回收量统计与清理执行入口。
 *
 * 清理执行链在 core `createDbMaintenanceService`（缓存 GC → 防御性
 * checkpoint → VACUUM，事务外、驱动层互斥串行）；本服务只补 mobile 侧
 * 事情——Agent 运行守卫与数据库文件体积采样（blob-util stat）。
 * 错误口径：主链路（统计主指标/清理执行）以 reject 语义上抛（由调用方
 * toast）。
 *
 * 存量 blob 归一与 VFS 历史版本打包两个后台搬运任务的状态透传已随
 * 第七轮退役删除（v1.5.41 同批，任务本体一并出列）。
 *
 * @module services/db-maintenance.service
 */
import {createDbMaintenanceService} from '@novel-master/core';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {blobFs} from './rn-file-io';
import {
  acquireMobileDbMaintenanceBusy,
  isMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from './db-maintenance-busy';

/** 数据库文件体积采样（blob-util stat 的 size 为字符串，统一转 number）。 */
async function statDatabaseFileBytes(): Promise<number> {
  const dbPath = await resolveMobileDatabaseFilePath();
  const info = await blobFs().stat(dbPath);
  return Number(info.size);
}

/**
 * 采样当前存储统计：数据库文件体积 + VACUUM 理论可回收量（只读 PRAGMA）。
 *
 * 仅用于展示，Agent 运行中抛中文 Error，由调用方决定静默或提示。
 */
export async function getDatabaseMaintenanceStats(
  runtime: MobileNovelMasterRuntime,
): Promise<{
  fileBytes: number;
  reclaimableBytes: number;
}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  const [fileBytes, stats] = await Promise.all([
    statDatabaseFileBytes(),
    createDbMaintenanceService(runtime.conn).getStorageStats(),
  ]);
  return {
    fileBytes,
    reclaimableBytes: stats.reclaimableBytes,
  };
}

/**
 * 执行数据清理（缓存 GC → checkpoint → VACUUM），返回前后文件体积。
 * VACUUM 耗时随库体积增长（大库数十秒）；期间计数式置 busy——后台搬运
 * 循环据此让路（与数据清理互斥）。
 */
export async function runDatabaseMaintenance(
  runtime: MobileNovelMasterRuntime,
): Promise<{beforeBytes: number; afterBytes: number}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  acquireMobileDbMaintenanceBusy();
  try {
    const beforeBytes = await statDatabaseFileBytes();
    await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
    const afterBytes = await statDatabaseFileBytes();
    return {beforeBytes, afterBytes};
  } finally {
    releaseMobileDbMaintenanceBusy();
  }
}

/** db 维护后台循环的让路守卫再导出（备份服务共用同一互斥口径）。 */
export {isMobileDbMaintenanceBusy};
