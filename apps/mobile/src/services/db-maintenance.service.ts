/**
 * 数据库维护（数据清理）mobile 服务：库体积/可回收量统计与清理执行入口。
 *
 * 清理执行链在 core `createDbMaintenanceService`（缓存 GC → 防御性
 * checkpoint → VACUUM，事务外、驱动层互斥串行）；本服务只补 mobile 侧
 * 两件事——Agent 运行守卫与数据库文件体积采样（blob-util stat）。
 * 错误一律以 reject 语义上抛（由调用方 toast），不吞错。
 *
 * @module services/db-maintenance.service
 */
import {createDbMaintenanceService} from '@novel-master/core';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {blobFs} from './rn-file-io';

/** 数据库文件体积采样（blob-util stat 的 size 为字符串，统一转 number）。 */
async function statDatabaseFileBytes(): Promise<number> {
  const dbPath = await resolveMobileDatabaseFilePath();
  const info = await blobFs().stat(dbPath);
  return Number(info.size);
}

/**
 * 采样当前存储统计：数据库文件体积 + VACUUM 理论可回收量（只读 PRAGMA）。
 * 仅用于展示，Agent 运行中抛中文 Error，由调用方决定静默或提示。
 */
export async function getDatabaseMaintenanceStats(
  runtime: MobileNovelMasterRuntime,
): Promise<{fileBytes: number; reclaimableBytes: number}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  const fileBytes = await statDatabaseFileBytes();
  const stats = await createDbMaintenanceService(
    runtime.conn,
  ).getStorageStats();
  return {fileBytes, reclaimableBytes: stats.reclaimableBytes};
}

/**
 * 执行数据清理（缓存 GC → checkpoint → VACUUM），返回前后文件体积。
 * VACUUM 耗时随库体积增长（大库数十秒），调用方须先置 busy 再调用。
 */
export async function runDatabaseMaintenance(
  runtime: MobileNovelMasterRuntime,
): Promise<{beforeBytes: number; afterBytes: number}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  const beforeBytes = await statDatabaseFileBytes();
  await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
  const afterBytes = await statDatabaseFileBytes();
  return {beforeBytes, afterBytes};
}
