/**
 * 云同步协调器：Pull / Push 编排，租约锁与 rev 对齐。
 *
 * @module infra/cloud-sync/impl/cloud-sync-coordinator
 */

import { CloudSyncError } from "../errors/cloud-sync-errors.js";
import {
  buildLease,
  canAcquireLock,
  DEFAULT_LEASE_SECONDS,
  isEffectiveLock,
  renewLease,
} from "../logic/lock.js";
import { snapshotKey, statusKey } from "../logic/paths.js";
import {
  EMPTY_CLOUD_SYNC_STATUS,
  parseCloudSyncStatus,
  type CloudSyncStatus,
} from "../model/cloud-sync-status.js";
import type { DbSyncPort } from "../ports/db-sync.port.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";

/** 协调器依赖：哈希与文件读取由调用方注入（Core 不使用 node:crypto） */
export type CloudSyncCoordinatorDeps = {
  storage: ObjectStoragePort;
  dbSync: DbSyncPort;
  pathPrefix: string;
  deviceId: string;
  exportTempPath: string;
  computeSha256Hex: (bytes: Uint8Array) => string;
  readSnapshotBytes: (path: string) => Promise<Uint8Array>;
  getSnapshotBytes: (path: string) => Promise<number>;
  leaseSeconds?: number;
};

export type PullOptions = {
  lastSyncedRev: number;
};

export type PullResult = {
  rev: number;
};

export type PushOptions = {
  lastSyncedRev: number;
  forceOverwriteRemote?: boolean;
};

export type PushResult = {
  rev: number;
};

/**
 * 跨端云同步核心编排：读取远端 status、Pull 导入、Push 抢锁上传。
 */
export class CloudSyncCoordinator {
  private readonly storage: ObjectStoragePort;
  private readonly dbSync: DbSyncPort;
  private readonly pathPrefix: string;
  private readonly deviceId: string;
  private readonly exportTempPath: string;
  private readonly computeSha256Hex: (bytes: Uint8Array) => string;
  private readonly readSnapshotBytes: (path: string) => Promise<Uint8Array>;
  private readonly getSnapshotBytes: (path: string) => Promise<number>;
  private readonly leaseSeconds: number;

  constructor(deps: CloudSyncCoordinatorDeps) {
    this.storage = deps.storage;
    this.dbSync = deps.dbSync;
    this.pathPrefix = deps.pathPrefix;
    this.deviceId = deps.deviceId;
    this.exportTempPath = deps.exportTempPath;
    this.computeSha256Hex = deps.computeSha256Hex;
    this.readSnapshotBytes = deps.readSnapshotBytes;
    this.getSnapshotBytes = deps.getSnapshotBytes;
    this.leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  }

  /** 拉取云端快照并导入本机数据库 */
  async pull(options: PullOptions): Promise<PullResult> {
    this.assertConfigured();

    const { status: remote } = await this.readRemoteStatus();

    if (remote.rev <= options.lastSyncedRev) {
      throw new CloudSyncError("ALREADY_UP_TO_DATE", "本地已是最新，无需拉取");
    }

    if (remote.rev > 0 && remote.snapshotKey == null) {
      throw new CloudSyncError("SNAPSHOT_MISSING", "云端快照缺失");
    }

    const snapKey = remote.snapshotKey!;
    const { body } = await this.storage.get(snapKey);
    const localHash = this.computeSha256Hex(body);
    if (remote.snapshotSha256 != null && localHash !== remote.snapshotSha256) {
      throw new CloudSyncError("CHECKSUM_MISMATCH", "下载快照校验失败");
    }

    await this.dbSync.importSnapshot(body);
    return { rev: remote.rev };
  }

  /** 导出本机快照并推送到云端（抢锁 → 上传 → 清锁） */
  async push(options: PushOptions): Promise<PushResult> {
    this.assertConfigured();

    if (this.dbSync.isAgentActive()) {
      throw new CloudSyncError("AGENT_ACTIVE", "Agent 运行中，请稍后再推送");
    }

    const { status: remote, etag: remoteEtag } = await this.readRemoteStatus();

    if (!options.forceOverwriteRemote && remote.rev > options.lastSyncedRev) {
      throw new CloudSyncError("NEED_PULL_FIRST", "云端有更新，请先拉取");
    }

    const newLock = buildLease(this.deviceId, this.leaseSeconds);
    if (!canAcquireLock(remote.lock, this.deviceId)) {
      throw new CloudSyncError("LOCK_HELD_BY_OTHER", "另一台设备正在同步，请稍后再推送");
    }

    const lockedStatus: CloudSyncStatus = { ...remote, lock: newLock };
    let statusEtag = await this.conditionalPutStatus(lockedStatus, remoteEtag);
    if (statusEtag == null) {
      throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
    }

    let lockHeldBySelf = true;

    try {
      await this.dbSync.exportSnapshotToPath(this.exportTempPath);
      const snapshotBytes = await this.readSnapshotBytes(this.exportTempPath);
      const hash = this.computeSha256Hex(snapshotBytes);
      const size = await this.getSnapshotBytes(this.exportTempPath);

      const nextRev = remote.rev + 1;
      const snapKey = snapshotKey(this.pathPrefix, nextRev);

      const uploadStart = Date.now();
      await this.storage.put(snapKey, snapshotBytes);
      const uploadElapsed = Date.now() - uploadStart;

      if (uploadElapsed > this.leaseSeconds * 500) {
        const renewedLock = renewLease(newLock, this.leaseSeconds);
        const renewedStatus: CloudSyncStatus = { ...lockedStatus, lock: renewedLock };
        const renewedEtag = await this.conditionalPutStatus(renewedStatus, statusEtag);
        if (renewedEtag != null) {
          statusEtag = renewedEtag;
        }
      }

      const finalStatus: CloudSyncStatus = {
        schemaVersion: 1,
        rev: nextRev,
        snapshotKey: snapKey,
        snapshotSha256: hash,
        snapshotBytes: size,
        uploadedAt: new Date().toISOString(),
        uploadedByDeviceId: this.deviceId,
        lock: null,
      };

      let finalEtag = await this.conditionalPutStatus(finalStatus, statusEtag);
      if (finalEtag == null) {
        const { etag: rereadEtag } = await this.readRemoteStatus();
        finalEtag = await this.conditionalPutStatus(finalStatus, rereadEtag);
        if (finalEtag == null) {
          throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
        }
      }

      lockHeldBySelf = false;
      return { rev: nextRev };
    } finally {
      if (lockHeldBySelf) {
        await this.tryClearLock(statusEtag);
      }
    }
  }

  private assertConfigured(): void {
    if (this.deviceId.trim().length === 0) {
      throw new CloudSyncError("NOT_CONFIGURED", "请先配置云存储");
    }
  }

  private async readRemoteStatus(): Promise<{
    status: CloudSyncStatus;
    etag?: string;
  }> {
    const key = statusKey(this.pathPrefix);
    const head = await this.storage.head(key);
    if (!head.exists) {
      return { status: { ...EMPTY_CLOUD_SYNC_STATUS }, etag: undefined };
    }

    const { body, etag } = await this.storage.get(key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch (error) {
      throw new CloudSyncError("INVALID_STATUS", "云端状态文件无法解析", {
        cause: error,
      });
    }

    return { status: parseCloudSyncStatus(parsed), etag };
  }

  private encodeStatus(status: CloudSyncStatus): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(status));
  }

  /**
   * 条件写入 status.json；If-Match 失败返回 null（不抛错）。
   */
  private async conditionalPutStatus(
    status: CloudSyncStatus,
    ifMatch?: string,
  ): Promise<string | null> {
    try {
      const { etag } = await this.storage.put(
        statusKey(this.pathPrefix),
        this.encodeStatus(status),
        ifMatch != null ? { ifMatch } : undefined,
      );
      return etag;
    } catch (error) {
      if (
        error instanceof CloudSyncError &&
        error.code === "LOCK_CONTENTION"
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Push 失败时尝试将锁清空（仅当仍由本机持有有效锁） */
  private async tryClearLock(lastKnownEtag?: string): Promise<void> {
    try {
      const { status, etag } = await this.readRemoteStatus();
      const effectiveEtag = etag ?? lastKnownEtag;
      if (effectiveEtag == null) {
        return;
      }

      const lock = status.lock;
      if (
        lock == null ||
        !isEffectiveLock(lock) ||
        lock.holderDeviceId !== this.deviceId
      ) {
        return;
      }

      const cleared: CloudSyncStatus = { ...status, lock: null };
      await this.conditionalPutStatus(cleared, effectiveEtag);
    } catch {
      // finally 清锁为尽力而为，不掩盖原始错误
    }
  }
}
