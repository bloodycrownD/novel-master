/**
 * 云同步协调器：Pull / Push 编排，租约锁与 rev 对齐。
 *
 * @module infra/cloud-sync/impl/cloud-sync-coordinator
 */

import { createLogger } from "@/infra/log/logger.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { buildLease, canAcquireLock, DEFAULT_LEASE_SECONDS, isEffectiveLock, renewLease } from "../logic/lock.js";
import { PushAgentMutex, type PushAgentLockHandle } from "../logic/push-agent-mutex.js";
import { snapshotKey, statusKey } from "../logic/paths.js";
import { EMPTY_CLOUD_SYNC_STATUS, parseCloudSyncStatus, type CloudSyncStatus } from "../model/cloud-sync-status.js";
import type { DbSyncPort } from "../ports/db-sync.port.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";

const log = createLogger("cloud-sync.coordinator");

/** 协调器依赖：哈希与文件读取由调用方注入（Core 不使用 node:crypto） */
// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
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

// nm-style: keep-public — M-25：apps runtime 的 agent 启动入口要与 coordinator 共享同一把进程内单例锁；本函数是单例状态 defaultPushMutex 的唯一访问器，内联会把单例契约摊进构造器。
/** 获取进程内默认 push/agent 互斥锁单例（apps runtime 的 agent 启动入口用同一个）。 */
export function getDefaultPushAgentMutex(): PushAgentMutex {
  if (defaultPushMutex == null) {
    defaultPushMutex = new PushAgentMutex();
  }
  return defaultPushMutex;
}

// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
export type PullOptions = {
  lastSyncedRev: number;
};

// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
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

// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
export type PushOptions = {
  lastSyncedRev: number;
  forceOverwriteRemote?: boolean;
};

// nm-style: keep-public — packages/core/src/index.ts 主入口再导出的公共类型契约（无生产直引）
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
  async pull(options: PullOptions): Promise<Result<PullResult, AppError>> {
    const unconfigured = this.notConfiguredError();
    if (unconfigured != null) return Result.err(unconfigured);

    const remoteStatus = await this.readRemoteStatus();
    if (!remoteStatus.ok) return Result.err(remoteStatus.error);
    const { status: remote } = remoteStatus.value;

    if (remote.rev <= options.lastSyncedRev) {
      return Result.err(new AppError("CLOUD_SYNC_ALREADY_UP_TO_DATE"));
    }

    if (remote.rev > 0 && remote.snapshotKey == null) {
      return Result.err(new AppError("CLOUD_SYNC_SNAPSHOT_MISSING"));
    }

    // 进程内互斥锁：pull 会整库替换活动库文件，必须与 push（以及将来的 agent
    // 启动入口）串行；超时降级拒绝（拒绝优于脏快照）。
    const lock = await this.acquireSyncLock("pull");
    if (!lock.ok) return Result.err(lock.error);
    try {
      const active = this.agentActiveError("pull");
      if (active != null) return Result.err(active);

      const snapKey = remote.snapshotKey!;
      let databaseReplaced = false;

      if (this.importTempPath != null && this.hashSnapshotFile != null && typeof this.storage.getToPath === "function" && typeof this.dbSync.importSnapshotFromPath === "function") {
        const tempPath = this.importTempPath!;
        const downloaded = await this.storage.getToPath!(snapKey, tempPath);
        if (!downloaded.ok) return Result.err(downloaded.error);
        const localHash = await this.hashSnapshotFile!(tempPath);
        if (remote.snapshotSha256 != null && localHash !== remote.snapshotSha256) {
          return Result.err(new AppError("CLOUD_SYNC_CHECKSUM_MISMATCH"));
        }
        // 覆盖活动库前二次复检：下载期间 agent 可能已经启动。
        const activeBeforeImport = this.agentActiveError("pull");
        if (activeBeforeImport != null) return Result.err(activeBeforeImport);
        const imported = await this.dbSync.importSnapshotFromPath!(tempPath);
        if (!imported.ok) return Result.err(imported.error);
        databaseReplaced = imported.value.databaseReplaced;
      } else {
        const { body } = await this.storage.get(snapKey);
        const localHash = this.computeSha256Hex(body);
        if (remote.snapshotSha256 != null && localHash !== remote.snapshotSha256) {
          return Result.err(new AppError("CLOUD_SYNC_CHECKSUM_MISMATCH"));
        }
        const activeBeforeImport = this.agentActiveError("pull");
        if (activeBeforeImport != null) return Result.err(activeBeforeImport);
        const imported = await this.dbSync.importSnapshot(body);
        if (!imported.ok) return Result.err(imported.error);
        databaseReplaced = imported.value.databaseReplaced;
      }

      return Result.ok({ rev: remote.rev, databaseReplaced });
    } finally {
      this.pushMutex.release(lock.value);
    }
  }

  /**
   * pull / push 侧 agent 复检：覆盖活动库文件会吃掉 agent 的在途写入或让它
   * 落进已废弃的 inode。命中返回业务错误（调用方 `Result.err` 上行），空闲返回 null。
   */
  private agentActiveError(kind: "pull" | "push"): AppError | null {
    if (!this.dbSync.isAgentActive()) return null;
    return new AppError("CLOUD_SYNC_AGENT_ACTIVE", { descriptor: { key: `error.cloud_sync.agent_active.${kind}` } });
  }

  /**
   * 导出本机快照并推送到云端（进程内互斥 → 抢云端锁 → 上传 → 清锁）。
   *
   * 收尾契约：**final status 条件写失败时，重读远端必须重新判定租约与 rev，
   * 禁止只取 etag 就覆盖**（否则远端 rev 回退 + 抹掉他人租约 ⇒ 跨设备静默错位）。
   */
  async push(options: PushOptions): Promise<Result<PushResult, AppError>> {
    const unconfigured = this.notConfiguredError();
    if (unconfigured != null) return Result.err(unconfigured);

    // 进程内互斥锁：push 持锁期间 agent 启动入口排队；超时降级拒绝
    const lock = await this.acquireSyncLock("push");
    if (!lock.ok) return Result.err(lock.error);
    try {
      // 入口仍保留 isAgentActive 检查：兼容 apps runtime 尚未接入互斥锁的旧路径
      // （旧 agent handler 不抢锁，只能靠这里拒绝）
      const entryActive = this.agentActiveError("push");
      if (entryActive != null) return Result.err(entryActive);

      const remoteStatus = await this.readRemoteStatus();
      if (!remoteStatus.ok) return Result.err(remoteStatus.error);
      const { status: remote, etag: remoteEtag } = remoteStatus.value;

      if (!options.forceOverwriteRemote && remote.rev > options.lastSyncedRev) {
        return Result.err(new AppError("CLOUD_SYNC_NEED_PULL_FIRST", { descriptor: { key: "error.cloud_sync.need_pull_first.remote_ahead" } }));
      }

      const newLock = buildLease(this.deviceId, this.leaseSeconds);
      if (!canAcquireLock(remote.lock, this.deviceId)) {
        return Result.err(new AppError("CLOUD_SYNC_LOCK_HELD_BY_OTHER"));
      }

      const lockedStatus: CloudSyncStatus = { ...remote, lock: newLock };
      const lockPut = await this.conditionalPutStatus(lockedStatus, remoteEtag);
      if (!lockPut.ok) return Result.err(lockPut.error);
      let statusEtag: string | null = lockPut.value;
      if (statusEtag == null) {
        return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION"));
      }

      let lockHeldBySelf = true;

      try {
        await this.dbSync.exportSnapshotToPath(this.exportTempPath);
        const size = await this.getSnapshotBytes(this.exportTempPath);

        const nextRev = remote.rev + 1;
        const snapKey = snapshotKey(this.pathPrefix, nextRev);

        let hash: string;
        const uploadStart = Date.now();
        if (this.hashSnapshotFile != null && typeof this.storage.putFile === "function") {
          hash = await this.hashSnapshotFile!(this.exportTempPath);
          const uploaded = await this.storage.putFile!(snapKey, this.exportTempPath);
          if (!uploaded.ok) return Result.err(uploaded.error);
        } else {
          const snapshotBytes = await this.readSnapshotBytes(this.exportTempPath);
          hash = this.computeSha256Hex(snapshotBytes);
          const uploaded = await this.storage.put(snapKey, snapshotBytes);
          if (!uploaded.ok) return Result.err(uploaded.error);
        }
        const uploadElapsed = Date.now() - uploadStart;

        // 续租点：上传耗时过长要续云端租约；同时复检本机 agent 状态。
        // 互斥锁接入后理论上 agent 进不来，但 apps 旧路径可能未抢锁——
        // agent 拍跑到这里就拒绝，走 finally 清云端锁，避免上传菲的快照续命。
        const uploadActive = this.agentActiveError("push");
        if (uploadActive != null) return Result.err(uploadActive);

        if (uploadElapsed > this.leaseSeconds * 500) {
          const renewedLock = renewLease(newLock, this.leaseSeconds);
          const renewedStatus: CloudSyncStatus = {
            ...lockedStatus,
            lock: renewedLock,
          };
          const renewedPut = await this.conditionalPutStatus(renewedStatus, statusEtag);
          const renewedEtag = renewedPut.ok ? renewedPut.value : null;
          if (renewedEtag != null) {
            statusEtag = renewedEtag;
          } else {
            // 续租条件写失败：statusEtag 保持旧值，下面的 final 写必然走重读判定分支。
            // 这里只留痕不抛错——重读分支已经能正确收尾，抛错会把「续租失败但收尾
            // 安全」误判成整次 push 失败（快照已上传、计数已上去）。
            // 目的是让下一个维护者不把「续租一定成功」当成不变量。
            log.warn("续租失败，final status 将走重读判定分支");
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

        const finalPut = await this.conditionalPutStatus(finalStatus, statusEtag);
        if (!finalPut.ok) return Result.err(finalPut.error);
        let finalEtag = finalPut.value;
        if (finalEtag == null) {
          // If-Match 失败 = 远端在我们上传期间被别人改过。重读远端后必须**重新判定**
          // 租约与 rev，禁止只取 etag 就把 finalStatus 覆盖上去：
          // finalStatus.rev 是最初 remote.rev + 1 算出的常量、lock 是 null，
          // 无条件覆盖会把远端 rev 写回更小的值并抹掉第三方的有效租约
          // ⇒ 跨设备静默数据错位，且两端都把自己记成成功。
          const latestStatus = await this.readRemoteStatus();
          if (!latestStatus.ok) return Result.err(latestStatus.error);
          const { status: latest, etag: rereadEtag } = latestStatus.value;
          // 两条判定必须并存：canAcquireLock 在「他人租约已过期」时返回 true，
          // 只判它仍会把已被别人推进的 rev 盖掉；latest.rev >= nextRev 才是
          // 「rev 是否被别人推进过」的唯一判据。
          if (!canAcquireLock(latest.lock, this.deviceId)) {
            return Result.err(new AppError("CLOUD_SYNC_LOCK_HELD_BY_OTHER"));
          }
          if (latest.rev >= nextRev) {
            return Result.err(new AppError("CLOUD_SYNC_NEED_PULL_FIRST", { descriptor: { key: "error.cloud_sync.need_pull_first.advanced_by_other" } }));
          }
          const retryPut = await this.conditionalPutStatus(finalStatus, rereadEtag);
          if (!retryPut.ok) return Result.err(retryPut.error);
          finalEtag = retryPut.value;
          if (finalEtag == null) {
            return Result.err(new AppError("CLOUD_SYNC_LOCK_CONTENTION"));
          }
        }

        lockHeldBySelf = false;
        return Result.ok({ rev: nextRev });
      } finally {
        if (lockHeldBySelf) {
          // Push 失败时尝试将锁清空（仅当仍由本机持有有效锁），尽力而为，不掩盖原始错误。
          try {
            const clearStatus = await this.readRemoteStatus();
            if (clearStatus.ok) {
              const { status: current, etag } = clearStatus.value;
              const effectiveEtag = etag ?? statusEtag;
              const currentLock = current.lock;
              if (effectiveEtag != null && currentLock != null && isEffectiveLock(currentLock) && currentLock.holderDeviceId === this.deviceId) {
                await this.conditionalPutStatus({ ...current, lock: null }, effectiveEtag);
              }
            }
          } catch {
            // finally 清锁为尽力而为，不掩盖原始错误
          }
        }
      }
    } finally {
      this.pushMutex.release(lock.value);
    }
  }

  /**
   * 申请 sync 互斥锁（pull 与 push 共用同一把进程内锁）；超时转成
   * PUSH_MUTEX_TIMEOUT（错误码不扩面，调用方据此降级拒绝）。
   */
  private async acquireSyncLock(operation: "pull" | "push" = "push"): Promise<Result<PushAgentLockHandle, AppError>> {
    try {
      const handle = await this.pushMutex.acquire({ timeoutMs: this.pushAcquireTimeoutMs });
      return Result.ok(handle);
    } catch (error) {
      if (isAppError(error, "AGENT_BUSY")) {
        const timeoutKey = operation === "pull" ? "error.cloud_sync.push_mutex_timeout.pull" : "error.cloud_sync.push_mutex_timeout.push";
        return Result.err(new AppError("CLOUD_SYNC_PUSH_MUTEX_TIMEOUT", { descriptor: { key: timeoutKey } }, { cause: error }));
      }
      throw error;
    }
  }

  /** 未配置 deviceId 时返回业务错误（调用方 `Result.err` 上行），已配置返回 null。 */
  private notConfiguredError(): AppError | null {
    if (this.deviceId.trim().length === 0) {
      return new AppError("CLOUD_SYNC_NOT_CONFIGURED");
    }
    return null;
  }

  private async readRemoteStatus(): Promise<Result<{ status: CloudSyncStatus; etag?: string }, AppError>> {
    const key = statusKey(this.pathPrefix);
    const head = await this.storage.head(key);
    if (!head.exists) {
      return Result.ok({ status: { ...EMPTY_CLOUD_SYNC_STATUS }, etag: undefined });
    }

    const { body, etag } = await this.storage.get(key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch (error) {
      return Result.err(new AppError("CLOUD_SYNC_INVALID_STATUS", { descriptor: { key: "error.cloud_sync.invalid_status.unparseable" } }, { cause: error }));
    }

    const validated = parseCloudSyncStatus(parsed);
    if (!validated.ok) return Result.err(validated.error);
    return Result.ok({ status: validated.value, etag });
  }

  /**
   * 条件写入 status.json；If-Match 竞态返回 ok(null)（业务态，不是失败），
   * 其它失败沿 Result.err 上行，决定权交给调用方。
   */
  private async conditionalPutStatus(status: CloudSyncStatus, ifMatch?: string): Promise<Result<string | null, AppError>> {
    const put = await this.storage.put(statusKey(this.pathPrefix), new TextEncoder().encode(JSON.stringify(status)), ifMatch != null ? { ifMatch } : undefined);
    if (!put.ok) {
      if (isAppError(put.error, "CLOUD_SYNC_LOCK_CONTENTION")) {
        return Result.ok(null);
      }
      return Result.err(put.error);
    }
    return Result.ok(put.value.etag);
  }
}
