/**
 * 数据库维护（数据清理）mobile 服务：库体积/可回收量统计与清理执行入口。
 *
 * 清理执行链在 core `createDbMaintenanceService`（缓存 GC → 防御性
 * checkpoint → VACUUM，事务外、驱动层互斥串行）；本服务只补 mobile 侧
 * 四件事——Agent 运行守卫、数据库文件体积采样（blob-util stat），以及
 * 两类后台搬运的状态透传（存量 blob 行形态归一「去 base64」+ 消息正文
 * 压缩，均只读 KKV 标记/谓词计数，存储页状态行数据源）。
 * 错误一律以 reject 语义上抛（由调用方 toast），不吞错。
 *
 * @module services/db-maintenance.service
 */
import {
  createDbMaintenanceService,
  getBlobBinaryStatus,
  getMessageCompactionStatus,
  type BlobBinaryTableStatus,
  type MessageCompactionStatus,
} from '@novel-master/core';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {blobFs} from './rn-file-io';
import {
  isMobileDbMaintenanceBusy,
  setMobileDbMaintenanceBusy,
} from './db-maintenance-busy';

/** 归一状态行 DTO 直通 core 类型，调用方无需再引 core（app 层单一出口）。 */
export type {BlobBinaryTableStatus, MessageCompactionStatus};

/** 数据库文件体积采样（blob-util stat 的 size 为字符串，统一转 number）。 */
async function statDatabaseFileBytes(): Promise<number> {
  const dbPath = await resolveMobileDatabaseFilePath();
  const info = await blobFs().stat(dbPath);
  return Number(info.size);
}

/**
 * 采样当前存储统计：数据库文件体积 + VACUUM 理论可回收量（只读 PRAGMA）
 * + 存量 blob 行形态归一（去 base64）各注册表的进度 + 消息压缩状态。
 *
 * `blobBinary` 直接透传 core `getBlobBinaryStatus` 的结果数组（只含已注册
 * 适配器的表，顺序与 core 注册表一致），调用方按 `table` 渲染状态行。
 * 两类状态稳态均为只读 KKV 标记，零 COUNT 成本。仅用于展示，Agent 运行
 * 中抛中文 Error，由调用方决定静默或提示。
 */
export async function getDatabaseMaintenanceStats(
  runtime: MobileNovelMasterRuntime,
): Promise<{
  fileBytes: number;
  reclaimableBytes: number;
  blobBinary: BlobBinaryTableStatus[];
  messageCompaction: MessageCompactionStatus;
}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  const [fileBytes, stats, blobBinary, messageCompaction] = await Promise.all([
    statDatabaseFileBytes(),
    createDbMaintenanceService(runtime.conn).getStorageStats(),
    getBlobBinaryStatus(runtime.conn),
    getMessageCompactionStatus(runtime.conn),
  ]);
  return {
    fileBytes,
    reclaimableBytes: stats.reclaimableBytes,
    blobBinary: [...blobBinary.tables],
    messageCompaction,
  };
}

/**
 * 执行数据清理（缓存 GC → checkpoint → VACUUM），返回前后文件体积。
 * VACUUM 耗时随库体积增长（大库数十秒）；期间置模块级 busy——消息
 * 压缩后台循环据此让路（与数据清理互斥）。
 */
export async function runDatabaseMaintenance(
  runtime: MobileNovelMasterRuntime,
): Promise<{beforeBytes: number; afterBytes: number}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  setMobileDbMaintenanceBusy(true);
  try {
    const beforeBytes = await statDatabaseFileBytes();
    await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
    const afterBytes = await statDatabaseFileBytes();
    return {beforeBytes, afterBytes};
  } finally {
    setMobileDbMaintenanceBusy(false);
  }
}

/** 消息压缩后台循环的让路守卫再导出（备份服务共用同一互斥口径）。 */
export {isMobileDbMaintenanceBusy};
