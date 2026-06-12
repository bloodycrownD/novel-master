/**
 * 云端 status.json 类型与 Zod 校验（schemaVersion 1）。
 *
 * @module infra/cloud-sync/model/cloud-sync-status
 */

import { z } from "zod";
import { CloudSyncError } from "../errors/cloud-sync-errors.js";

/** 租约锁 */
export type CloudSyncLock = {
  holderDeviceId: string;
  acquiredAt: string;
  expiresAt: string;
};

/** 远端 status.json 文档 */
export type CloudSyncStatus = {
  schemaVersion: 1;
  rev: number;
  snapshotKey?: string;
  snapshotSha256?: string;
  snapshotBytes?: number;
  uploadedAt?: string;
  uploadedByDeviceId?: string;
  lock: CloudSyncLock | null;
};

const lockSchema = z
  .object({
    holderDeviceId: z.string().min(1),
    acquiredAt: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const cloudSyncStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    rev: z.number().int().nonnegative(),
    snapshotKey: z.string().min(1).optional(),
    snapshotSha256: z.string().min(1).optional(),
    snapshotBytes: z.number().int().nonnegative().optional(),
    uploadedAt: z.string().min(1).optional(),
    uploadedByDeviceId: z.string().min(1).optional(),
    lock: z.union([lockSchema, z.null()]),
  })
  .strict();

/** rev=0 且无快照时的默认远端状态 */
export const EMPTY_CLOUD_SYNC_STATUS: CloudSyncStatus = {
  schemaVersion: 1,
  rev: 0,
  lock: null,
};

/**
 * 解析并校验 status.json 载荷；失败抛出 {@link CloudSyncError} `INVALID_STATUS`。
 */
export function parseCloudSyncStatus(raw: unknown): CloudSyncStatus {
  const result = cloudSyncStatusSchema.safeParse(raw);
  if (!result.success) {
    throw new CloudSyncError(
      "INVALID_STATUS",
      "云端状态文件格式无效",
      { cause: result.error },
    );
  }
  return result.data;
}
