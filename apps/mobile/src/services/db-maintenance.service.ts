/**
 * 数据库维护（数据清理）mobile 服务：库体积/可回收量统计与清理执行入口。
 *
 * 清理执行链在 core `createDbMaintenanceService`（缓存 GC → 防御性
 * checkpoint → VACUUM，事务外、驱动层互斥串行）；本服务只补 mobile 侧
 * 事情——Agent 运行守卫、数据库文件体积采样（blob-util stat），以及
 * 三类后台搬运的状态透传（存量 blob 行形态归一「去 base64」+ 消息正文
 * 解压回明文 + VFS 历史版本打包，均只读 KKV 标记/谓词计数，存储页状态行
 * 数据源）。
 * 错误口径：主链路（统计主指标/清理执行）以 reject 语义上抛（由调用方
 * toast）；三类状态采样是附属展示字段，独立兜底降级不上抛（见各自
 * sample 函数）。
 *
 * @module services/db-maintenance.service
 */
import {
  createDbMaintenanceService,
  getBlobBinaryStatus,
  getMessageDecompressStatus,
  getVfsContentPackStatus,
  type BlobBinaryTableStatus,
  type MessageDecompressStatus,
  type TdbcConnection,
  type VfsContentPackStatus,
} from '@novel-master/core';
import {resolveMobileDatabaseFilePath} from '../db/db-file-path';
import {isMobileAgentActive} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {blobFs} from './rn-file-io';
import {
  acquireMobileDbMaintenanceBusy,
  isMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from './db-maintenance-busy';

/** 归一状态行 DTO 直通 core 类型，调用方无需再引 core（app 层单一出口）。 */
export type {BlobBinaryTableStatus, MessageDecompressStatus, VfsContentPackStatus};

/** 数据库文件体积采样（blob-util stat 的 size 为字符串，统一转 number）。 */
async function statDatabaseFileBytes(): Promise<number> {
  const dbPath = await resolveMobileDatabaseFilePath();
  const info = await blobFs().stat(dbPath);
  return Number(info.size);
}

/**
 * blob 归一状态采样（附属展示字段，独立兜底）：失败只 console.warn 一次
 * 后返回空数组，不打拖主统计（库体积/可回收量）——对齐 desktop 侧同名
 * sample 的降级口径，空数组由 UI 渲染成占位 '—'。
 */
async function sampleBlobBinaryStatus(
  conn: TdbcConnection,
): Promise<BlobBinaryTableStatus[]> {
  try {
    // 数组直接给列表渲染用：FlatList 需要稳定的扁平数组，故在此拍平；
    // desktop 走 IPC DTO 惯例保留 { tables } 包装，两端形状不统一是
    // 有意为之。
    return [...(await getBlobBinaryStatus(conn)).tables];
  } catch (err) {
    console.warn('[db-maintenance] blobBinary 状态采样失败，展示为空', err);
    return [];
  }
}

/**
 * 消息解压状态采样（附属展示字段，独立兜底）：失败只 console.warn 一次
 * 后返回 null，UI 侧 null → 占位 '—'（与 blobBinary 空表同口径）。
 */
async function sampleMessageDecompressStatus(
  conn: TdbcConnection,
): Promise<MessageDecompressStatus | null> {
  try {
    return await getMessageDecompressStatus(conn);
  } catch (err) {
    console.warn(
      '[db-maintenance] messageDecompress 状态采样失败，展示为占位',
      err,
    );
    return null;
  }
}

/**
 * VFS 历史版本打包状态采样（附属展示字段，独立兜底）：失败只
 * console.warn 一次后返回 null，UI 侧 null → 占位 '—'（与
 * messageDecompress 同口径）。core 侧自带 3s 采样节流（候选谓词查询
 * 防轮询 IO 放大），本层不再节流。
 */
async function sampleVfsPackStatus(
  conn: TdbcConnection,
): Promise<VfsContentPackStatus | null> {
  try {
    return await getVfsContentPackStatus(conn);
  } catch (err) {
    console.warn(
      '[db-maintenance] vfsPack 状态采样失败，展示为占位',
      err,
    );
    return null;
  }
}

/**
 * 采样当前存储统计：数据库文件体积 + VACUUM 理论可回收量（只读 PRAGMA）
 * + 存量 blob 行形态归一（去 base64）各注册表的进度 + 消息解压状态 +
 * VFS 历史版本打包状态。
 *
 * `blobBinary` 为 core `getBlobBinaryStatus` 结果数组的拍平形态（只含已
 * 注册适配器的表，顺序与 core 注册表一致），调用方按 `table` 渲染状态行。
 * blobBinary/解压状态稳态均为只读 KKV 标记，零 COUNT 成本；vfsPack 带
 * 3s 节流（见 sample 注释）。仅用于展示，Agent 运行中抛中文 Error，由
 * 调用方决定静默或提示。
 *
 * 主统计（体积/可回收量）与三类状态采样各自独立兜底：状态采样失败只
 * warn 一次并降级（blobBinary → 空数组、messageDecompress/vfsPack →
 * null），不把附属展示字段的失败源传染给主统计指标（与 desktop 同口径）。
 */
export async function getDatabaseMaintenanceStats(
  runtime: MobileNovelMasterRuntime,
): Promise<{
  fileBytes: number;
  reclaimableBytes: number;
  blobBinary: BlobBinaryTableStatus[];
  messageDecompress: MessageDecompressStatus | null;
  vfsPack: VfsContentPackStatus | null;
}> {
  if (isMobileAgentActive()) {
    throw new Error('Agent 运行中，请稍后再操作');
  }
  const [fileBytes, stats] = await Promise.all([
    statDatabaseFileBytes(),
    createDbMaintenanceService(runtime.conn).getStorageStats(),
  ]);
  const blobBinary = await sampleBlobBinaryStatus(runtime.conn);
  const messageDecompress = await sampleMessageDecompressStatus(
    runtime.conn,
  );
  const vfsPack = await sampleVfsPackStatus(runtime.conn);
  return {
    fileBytes,
    reclaimableBytes: stats.reclaimableBytes,
    blobBinary,
    messageDecompress,
    vfsPack,
  };
}

/**
 * 执行数据清理（缓存 GC → checkpoint → VACUUM），返回前后文件体积。
 * VACUUM 耗时随库体积增长（大库数十秒）；期间计数式置 busy——消息
 * 解压与 blob 归一后台循环据此让路（与数据清理互斥）。
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

/** 消息解压后台循环的让路守卫再导出（备份服务共用同一互斥口径）。 */
export {isMobileDbMaintenanceBusy};
