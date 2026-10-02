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
   * 进程内 sync/agent 互斥锁（session 维度）。
   *
   * 不传时使用模块级单例——coordinator 实例可能每次 build 都新建，
   * 但 sync 之间（pull ↔ push）需要共享同一把锁，所以默认走单例。
   *
   * ⚠️ 事实态（注释诚实化）：**「sync ↔ agent」这一段目前是空的**——
   * `getDefaultPushAgentMutex` 未从 `infra/cloud-sync/index.ts` 导出，
   * apps 侧（desktop / mobile）也零 acquire；agent 启动入口尚未接线，
   * 靠 `dbSync.isAgentActive()` 的入口复检兜底。见 M-25。
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
  /**
   * 本次拉取是否真的替换了活动库文件。
   *
   * 调用方据此决定是否重建 runtime；`false` ⇒ 库文件没换、连接没关，
   * 调用方持有的 runtime 仍然有效。
   */
  databaseReplaced: boolean;
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

  /**
   * 拉取云端快照并导入本机数据库（进程内互斥 → agent 复检 → 下载校验 → 导入）。
   *
   * 契约顺序：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
   * 本方法只负责到「换库」并回报 `databaseReplaced`；重建与记账在调用方
   * （service / handler 层），且必须排在 coordinator 返回之后。
   *
   * 守卫位置：agent 复检放在 `ALREADY_UP_TO_DATE` / `SNAPSHOT_MISSING` 两个
   * 早返回**之后**、开始搬运快照之前——一次「什么都不会发生」的 no-op pull
   * 不应该因为 agent 正在跑而被拒。真正覆盖活动库文件之前再复检一次
   * （下载期间 agent 可能启动），两条 import 分支紧邻调用处各一次。
   */
  async pull(options: PullOptions): Promise<PullResult> {
    this.assertConfigured();

    const { status: remote } = await this.readRemoteStatus();

    if (remote.rev <= options.lastSyncedRev) {
      throw new CloudSyncError("ALREADY_UP_TO_DATE", "本地已是最新，无需拉取");
    }

    if (remote.rev > 0 && remote.snapshotKey == null) {
      throw new CloudSyncError("SNAPSHOT_MISSING", "云端快照缺失");
    }

    // 进程内互斥锁：pull 会整库替换活动库文件，必须与 push（以及将来的 agent
    // 启动入口）串行；超时降级拒绝（拒绝优于脏快照）。
    const lockHandle = await this.acquireSyncLock("pull");
    try {
      this.assertAgentIdleForPull();

      const snapKey = remote.snapshotKey!;
      let databaseReplaced = false;

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
        // 覆盖活动库前二次复检：下载期间 agent 可能已经启动。
        this.assertAgentIdleForPull();
        const outcome = await this.dbSync.importSnapshotFromPath!(tempPath);
        databaseReplaced = outcome?.databaseReplaced === true;
      } else {
        const { body } = await this.storage.get(snapKey);
        const localHash = this.computeSha256Hex(body);
        if (
          remote.snapshotSha256 != null &&
          localHash !== remote.snapshotSha256
        ) {
          throw new CloudSyncError("CHECKSUM_MISMATCH", "下载快照校验失败");
        }
        this.assertAgentIdleForPull();
        const outcome = await this.dbSync.importSnapshot(body);
        databaseReplaced = outcome?.databaseReplaced === true;
      }

      return { rev: remote.rev, databaseReplaced };
    } finally {
      this.pushMutex.release(lockHandle);
    }
  }

  /** pull 侧 agent 复检：覆盖活动库文件会吃掉 agent 的在途写入或让它落进已废弃的 inode。 */
  private assertAgentIdleForPull(): void {
    if (this.dbSync.isAgentActive()) {
      throw new CloudSyncError("AGENT_ACTIVE", "Agent 运行中，请稍后再拉取");
    }
  }

  /** 导出本机快照并推送到云端（进程内互斥 → 抢云端锁 → 上传 → 清锁） */
  async push(options: PushOptions): Promise<PushResult> {
    this.assertConfigured();

    // 进程内互斥锁：push 持锁期间 agent 启动入口排队；超时降级拒绝
    const lockHandle = await this.acquireSyncLock("push");
    try {
      return await this.runPush(options);
    } finally {
      this.pushMutex.release(lockHandle);
    }
  }

  /**
   * 申请 sync 互斥锁（pull 与 push 共用同一把进程内锁）；超时转成
   * PUSH_MUTEX_TIMEOUT（错误码不扩面，调用方据此降级拒绝）。
   */
  private async acquireSyncLock(
    operation: "pull" | "push" = "push"
  ): Promise<PushAgentLockHandle> {
    try {
      return await this.pushMutex.acquire({
        timeoutMs: this.pushAcquireTimeoutMs,
      });
    } catch (error) {
      if (error instanceof PushAgentMutexAcquireError) {
        throw new CloudSyncError(
          "PUSH_MUTEX_TIMEOUT",
          operation === "pull"
            ? "拉取繁忙，等待互斥锁超时，请稍后再试"
            : "推送繁忙，等待互斥锁超时，请稍后再试",
          { cause: error }
        );
      }
      throw error;
    }
  }

  /**
   * @deprecated 旧名保留（core 内部测试以外的引用不因此断裂）；新代码用
   * {@link CloudSyncCoordinator.acquireSyncLock}。
   */
  protected acquirePushLock(): Promise<PushAgentLockHandle> {
    return this.acquireSyncLock("push");
  }

  /**
   * push 主体；调用方负责持有进程内互斥锁。
   *
   * 收尾契约：**final status 条件写失败时，重读远端必须重新判定租约与 rev，
   * 禁止只取 etag 就覆盖**（否则远端 rev 回退 + 抹掉他人租约 ⇒ 跨设备静默错位）。
   */
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
        } else {
          // 续租条件写失败：statusEtag 保持旧值，下面的 final 写必然走重读判定分支。
          // 这里只留痕不抛错——重读分支已经能正确收尾，抛错会把「续租失败但收尾
          // 安全」误判成整次 push 失败（快照已上传、计数已上去）。
          // 目的是让下一个维护者不把「续租一定成功」当成不变量。
          console.warn(
            "[cloud-sync] 续租失败，final status 将走重读判定分支"
          );
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
        // If-Match 失败 = 远端在我们上传期间被别人改过。重读远端后必须**重新判定**
        // 租约与 rev，禁止只取 etag 就把 finalStatus 覆盖上去：
        // finalStatus.rev 是最初 remote.rev + 1 算出的常量、lock 是 null，
        // 无条件覆盖会把远端 rev 写回更小的值并抹掉第三方的有效租约
        // ⇒ 跨设备静默数据错位，且两端都把自己记成成功。
        const { status: latest, etag: rereadEtag } = await this.readRemoteStatus();
        // 两条判定必须并存：canAcquireLock 在「他人租约已过期」时返回 true，
        // 只判它仍会把已被别人推进的 rev 盖掉；latest.rev >= nextRev 才是
        // 「rev 是否被别人推进过」的唯一判据。
        if (!canAcquireLock(latest.lock, this.deviceId)) {
          throw new CloudSyncError(
            "LOCK_HELD_BY_OTHER",
            "另一台设备正在同步，请稍后再推送"
          );
        }
        if (latest.rev >= nextRev) {
          throw new CloudSyncError(
            "NEED_PULL_FIRST",
            "云端已被其他设备推进，请先拉取"
          );
        }
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
