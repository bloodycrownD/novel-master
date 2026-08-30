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
import {
  PushAgentMutex,
  PushAgentMutexAcquireError,
  type PushAgentLockHandle,
} from "../logic/push-agent-mutex.js";
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
  /** 分块从文件计算 SHA-256（可选；与 putFile/getToPath 配合走文件路径） */
  hashSnapshotFile?: (path: string) => Promise<string>;
  /** Pull 时下载快照的临时路径（可选；与 getToPath 配合） */
  importTempPath?: string;
  leaseSeconds?: number;
  /**
   * 进程内 push/agent 互斥锁（session 维度）。
   *
   * 不传时使用模块级单例——coordinator 实例可能每次 build 都新建，
   * 但 push 之间、push 与 agent 之间需要共享同一把锁，所以默认走单例。
   * apps runtime 在 agent 启动入口应拿到同一实例（通过 {@link getDefaultPushAgentMutex}）。
   */
  pushMutex?: PushAgentMutex;
  /** push 入口等待互斥锁的最长时间（毫秒）；超时降级拒绝。 */
  pushAcquireTimeoutMs?: number;
};

/** 模块级默认互斥锁单例；coordinator 与 apps runtime 共享。 */
let defaultPushMutex: PushAgentMutex | null = null;

/** 获取进程内默认 push/agent 互斥锁单例（apps runtime 的 agent 启动入口用同一个）。 */
export function getDefaultPushAgentMutex(): PushAgentMutex {
  if (defaultPushMutex == null) {
    defaultPushMutex = new PushAgentMutex();
  }
  return defaultPushMutex;
}

/** 重置默认单例（仅测试用；生产代码不要调）。 */
export function __resetDefaultPushAgentMutexForTests(): void {
  defaultPushMutex = null;
}

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
  private readonly hashSnapshotFile?: (path: string) => Promise<string>;
  private readonly importTempPath?: string;
  private readonly leaseSeconds: number;
  private readonly pushMutex: PushAgentMutex;
  private readonly pushAcquireTimeoutMs: number;

  constructor(deps: CloudSyncCoordinatorDeps) {
    this.storage = deps.storage;
    this.dbSync = deps.dbSync;
    this.pathPrefix = deps.pathPrefix;
    this.deviceId = deps.deviceId;
    this.exportTempPath = deps.exportTempPath;
    this.computeSha256Hex = deps.computeSha256Hex;
    this.readSnapshotBytes = deps.readSnapshotBytes;
    this.getSnapshotBytes = deps.getSnapshotBytes;
    this.hashSnapshotFile = deps.hashSnapshotFile;
    this.importTempPath = deps.importTempPath;
    this.leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.pushMutex = deps.pushMutex ?? getDefaultPushAgentMutex();
    // 默认 30s：push 通常很快，agent 启动等 30s 还等不到就降级拒绝
    this.pushAcquireTimeoutMs = deps.pushAcquireTimeoutMs ?? 30_000;
  }

  /** Push 是否可走文件路径（分块哈希 + 单次读文件上传） */
  private canUseFilePathPush(): boolean {
    return (
      this.hashSnapshotFile != null &&
      typeof this.storage.putFile === "function"
    );
  }

  /** Pull 是否可走文件路径（下载写盘 + 分块哈希 + 路径导入） */
  private canUseFilePathPull(): boolean {
    return (
      this.importTempPath != null &&
      this.hashSnapshotFile != null &&
      typeof this.storage.getToPath === "function" &&
      typeof this.dbSync.importSnapshotFromPath === "function"
    );
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

    if (this.canUseFilePathPull()) {
      const tempPath = this.importTempPath!;
      await this.storage.getToPath!(snapKey, tempPath);
      const localHash = await this.hashSnapshotFile!(tempPath);
      if (
        remote.snapshotSha256 != null &&
        localHash !== remote.snapshotSha256
      ) {
        throw new CloudSyncError("CHECKSUM_MISMATCH", "下载快照校验失败");
      }
      await this.dbSync.importSnapshotFromPath!(tempPath);
    } else {
      const { body } = await this.storage.get(snapKey);
      const localHash = this.computeSha256Hex(body);
      if (
        remote.snapshotSha256 != null &&
        localHash !== remote.snapshotSha256
      ) {
        throw new CloudSyncError("CHECKSUM_MISMATCH", "下载快照校验失败");
      }
      await this.dbSync.importSnapshot(body);
    }

    return { rev: remote.rev };
  }

  /** 导出本机快照并推送到云端（进程内互斥 → 抢云端锁 → 上传 → 清锁） */
  async push(options: PushOptions): Promise<PushResult> {
    this.assertConfigured();

    // 进程内互斥锁：push 持锁期间 agent 启动入口排队；超时降级拒绝
    const lockHandle = await this.acquirePushLock();
    try {
      return await this.runPush(options);
    } finally {
      this.pushMutex.release(lockHandle);
    }
  }

  /** 申请 push 互斥锁；超时转成 PUSH_MUTEX_TIMEOUT（调用方据此降级拒绝）。 */
  private async acquirePushLock(): Promise<PushAgentLockHandle> {
    try {
      return await this.pushMutex.acquire({
        timeoutMs: this.pushAcquireTimeoutMs,
      });
    } catch (error) {
      if (error instanceof PushAgentMutexAcquireError) {
        throw new CloudSyncError(
          "PUSH_MUTEX_TIMEOUT",
          "推送繁忙，等待互斥锁超时，请稍后再试",
          { cause: error }
        );
      }
      throw error;
    }
  }

  /** push 主体；调用方负责持有进程内互斥锁。 */
  private async runPush(options: PushOptions): Promise<PushResult> {
    // 入口仍保留 isAgentActive 检查：兼容 apps runtime 尚未接入互斥锁的旧路径
    // （旧 agent handler 不抢锁，只能靠这里拒绝）
    if (this.dbSync.isAgentActive()) {
      throw new CloudSyncError("AGENT_ACTIVE", "Agent 运行中，请稍后再推送");
    }

    const { status: remote, etag: remoteEtag } = await this.readRemoteStatus();

    if (!options.forceOverwriteRemote && remote.rev > options.lastSyncedRev) {
      throw new CloudSyncError("NEED_PULL_FIRST", "云端有更新，请先拉取");
    }

    const newLock = buildLease(this.deviceId, this.leaseSeconds);
    if (!canAcquireLock(remote.lock, this.deviceId)) {
      throw new CloudSyncError(
        "LOCK_HELD_BY_OTHER",
        "另一台设备正在同步，请稍后再推送"
      );
    }

    const lockedStatus: CloudSyncStatus = { ...remote, lock: newLock };
    let statusEtag = await this.conditionalPutStatus(lockedStatus, remoteEtag);
    if (statusEtag == null) {
      throw new CloudSyncError("LOCK_CONTENTION", "同步冲突，请重试");
    }

    let lockHeldBySelf = true;

    try {
      await this.dbSync.exportSnapshotToPath(this.exportTempPath);
      const size = await this.getSnapshotBytes(this.exportTempPath);

      const nextRev = remote.rev + 1;
      const snapKey = snapshotKey(this.pathPrefix, nextRev);

      let hash: string;
      const uploadStart = Date.now();
      if (this.canUseFilePathPush()) {
        hash = await this.hashSnapshotFile!(this.exportTempPath);
        await this.storage.putFile!(snapKey, this.exportTempPath);
      } else {
        const snapshotBytes = await this.readSnapshotBytes(this.exportTempPath);
        hash = this.computeSha256Hex(snapshotBytes);
        await this.storage.put(snapKey, snapshotBytes);
      }
      const uploadElapsed = Date.now() - uploadStart;

      // 续租点：上传耗时过长要续云端租约；同时复检本机 agent 状态。
      // 互斥锁接入后理论上 agent 进不来，但 apps 旧路径可能未抢锁——
      // agent 拍跑到这里就拒绝，走 finally 清云端锁，避免上传菲的快照续命。
      if (this.dbSync.isAgentActive()) {
        throw new CloudSyncError("AGENT_ACTIVE", "Agent 运行中，请稍后再推送");
      }

      if (uploadElapsed > this.leaseSeconds * 500) {
        const renewedLock = renewLease(newLock, this.leaseSeconds);
        const renewedStatus: CloudSyncStatus = {
          ...lockedStatus,
          lock: renewedLock,
        };
        const renewedEtag = await this.conditionalPutStatus(
          renewedStatus,
          statusEtag
        );
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
    ifMatch?: string
  ): Promise<string | null> {
    try {
      const { etag } = await this.storage.put(
        statusKey(this.pathPrefix),
        this.encodeStatus(status),
        ifMatch != null ? { ifMatch } : undefined
      );
      return etag;
    } catch (error) {
      if (error instanceof CloudSyncError && error.code === "LOCK_CONTENTION") {
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
