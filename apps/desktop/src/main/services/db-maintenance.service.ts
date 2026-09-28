/**
 * Desktop 数据库维护（数据清理）服务：存储统计 + 执行清理维护链路。
 *
 * @module services/db-maintenance
 */
import { stat } from "node:fs/promises";
import {
  createDbMaintenanceService,
  getBlobBinaryStatus,
  getMessageCompactionStatus,
  getVfsContentPackStatus,
} from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import {
  isDesktopDbMaintenanceBusy,
  setDesktopDbMaintenanceBusy,
} from "./db-maintenance-busy.js";
import type {
  BlobBinaryStatusDto,
  MessageCompactionStatusDto,
  VfsContentPackStatusDto,
} from "../../../shared/ipc-types.js";

/** 采样存储统计：库文件体积（main 侧 stat）+ freelist 可回收量（core PRAGMA）+ 三类搬运状态。 */
export async function getDbMaintenanceStats(): Promise<{
  fileBytes: number;
  reclaimableBytes: number;
  blobBinary: BlobBinaryStatusDto;
  messageCompaction: MessageCompactionStatusDto | null;
  vfsPack: VfsContentPackStatusDto | null;
}> {
  // 先确保 runtime/库文件就绪再 stat：并行赛跑会在冷启动（库尚未
  // bootstrap 落盘）时拿到 ENOENT。
  const runtime = await getDesktopRuntime();
  const fileInfo = await stat(resolveDbPath());
  const maintenance = createDbMaintenanceService(runtime.conn);
  const [storage, messageCompaction] = await Promise.all([
    maintenance.getStorageStats(),
    // 消息压缩状态行数据源（稳态已完成时只读 KKV 标记，零 COUNT 成本）。
    sampleMessageCompactionStatus(runtime.conn),
  ]);
  return {
    fileBytes: fileInfo.size,
    reclaimableBytes: storage.reclaimableBytes,
    blobBinary: await sampleBlobBinaryStatus(runtime.conn),
    messageCompaction,
    vfsPack: await sampleVfsPackStatus(runtime.conn),
  };
}

/**
 * 采样消息正文压缩搬运状态（存储页状态行）。
 *
 * 与 {@link sampleBlobBinaryStatus} 同口径：附属信息采样失败不拖垮
 * db/stats 主统计，吞掉异常按「未取到」展示——返回 `null`（ic-04），
 * renderer 侧 null 分支显示占位 '—'；不再用 `{done:false,pendingCount:0}`
 * 假数据（会被渲染成不真的「进行中（剩余 0 条）」）。
 */
async function sampleMessageCompactionStatus(
  conn: Parameters<typeof getMessageCompactionStatus>[0],
): Promise<MessageCompactionStatusDto | null> {
  try {
    return await getMessageCompactionStatus(conn);
  } catch (err) {
    console.warn(
      "[desktop] 采样消息压缩状态失败：",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 采样存量 blob 形态归一状态（存储页状态行）。
 *
 * 归一状态是附属信息：采样失败（老库缺表/连接异常）不应让整个 db/stats
 * 失败，否则库体积与可回收量也一起显示不出来——故吞掉异常返回空表，
 * renderer 侧按「未取到」展示占位 '—'。
 */
async function sampleBlobBinaryStatus(
  conn: Parameters<typeof getBlobBinaryStatus>[0],
): Promise<BlobBinaryStatusDto> {
  try {
    const status = await getBlobBinaryStatus(conn);
    return { tables: status.tables.map((row) => ({ ...row })) };
  } catch (err) {
    console.warn(
      "[desktop] 采样 blob 形态归一状态失败：",
      err instanceof Error ? err.message : err,
    );
    return { tables: [] };
  }
}

/**
 * 采样 VFS 历史版本打包状态（迁移卡第四行）。
 *
 * 与 {@link sampleMessageCompactionStatus} 同口径：附属信息采样失败不
 * 拖垮 db/stats 主统计，吞掉异常按「未取到」展示——返回 `null`，
 * renderer 侧 null 分支显示占位 '—'。core 侧自带 3s 采样节流（候选谓词
 * 查询防 2s 轮询 IO 放大），本层不再节流。
 */
async function sampleVfsPackStatus(
  conn: Parameters<typeof getVfsContentPackStatus>[0],
): Promise<VfsContentPackStatusDto | null> {
  try {
    return await getVfsContentPackStatus(conn);
  } catch (err) {
    console.warn(
      "[desktop] 采样 VFS 历史版本打包状态失败：",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 执行数据清理：stat 前体积 → core 维护链路（缓存 GC → checkpoint →
 * VACUUM）→ stat 后体积。
 *
 * better-sqlite3 的 VACUUM 是同步执行，期间 main 事件循环冻结——所以
 * busy 必须在进入本函数后立刻置位（renderer 侧也不得不前置 busy，不
 * 能依赖 main 推送），并用 try/finally 保证任何失败路径都复位。
 */
export async function runDbMaintenance(): Promise<{
  beforeBytes: number;
  afterBytes: number;
}> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再操作");
  }
  if (isDesktopCloudSyncBusy()) {
    throw new Error("云同步进行中，请稍后再操作");
  }
  if (isDesktopDbMaintenanceBusy()) {
    throw new Error("数据清理进行中，请稍后再操作");
  }
  setDesktopDbMaintenanceBusy(true);
  try {
    // 与 getDbMaintenanceStats 同口径：先确保 runtime/库文件就绪再 stat，
    // 冷启动（库尚未 bootstrap 落盘）时避免 ENOENT。
    const runtime = await getDesktopRuntime();
    const dbPath = resolveDbPath();
    const beforeInfo = await stat(dbPath);
    await createDbMaintenanceService(runtime.conn).runDatabaseMaintenance();
    const afterInfo = await stat(dbPath);
    return {
      beforeBytes: beforeInfo.size,
      afterBytes: afterInfo.size,
    };
  } finally {
    setDesktopDbMaintenanceBusy(false);
  }
}
