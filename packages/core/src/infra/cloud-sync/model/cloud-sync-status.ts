/**
 * 云端 status.json 类型与 Zod 校验（schemaVersion 1）。
 *
 * @module infra/cloud-sync/model/cloud-sync-status
 */

import { z } from "zod";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

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

const lockSchema = z.object({ holderDeviceId: z.string().min(1), acquiredAt: z.string().min(1), expiresAt: z.string().min(1) }).strict();

const cloudSyncStatusShape = {
  schemaVersion: z.literal(1),
  rev: z.number().int().nonnegative(),
  snapshotKey: z.string().min(1).optional(),
  snapshotSha256: z.string().min(1).optional(),
  snapshotBytes: z.number().int().nonnegative().optional(),
  uploadedAt: z.string().min(1).optional(),
  uploadedByDeviceId: z.string().min(1).optional(),
  lock: z.union([lockSchema, z.null()]),
};

const cloudSyncStatusSchema = z.object(cloudSyncStatusShape).strict();

/** rev=0 且无快照时的默认远端状态 */
export const EMPTY_CLOUD_SYNC_STATUS: CloudSyncStatus = {
  schemaVersion: 1,
  rev: 0,
  lock: null,
};

/**
 * status.json 文档解析（schemaVersion 1 校验）。
 */
export const CloudSyncStatusParser = {
  /**
   * 解析并校验 status.json 载荷；失败沿 `Result.err` 返回 `CLOUD_SYNC_INVALID_STATUS`。
   */
  parse(raw: unknown): Result<CloudSyncStatus, AppError> {
    const result = cloudSyncStatusSchema.safeParse(raw);
    if (!result.success) {
      return Result.err(new AppError("CLOUD_SYNC_INVALID_STATUS", { descriptor: { key: "error.cloud_sync.invalid_status.schema_invalid" } }, { cause: result.error }));
    }
    return Result.ok(result.data);
  },
} as const;
