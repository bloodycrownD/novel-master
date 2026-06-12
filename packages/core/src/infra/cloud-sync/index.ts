/**
 * 跨端云同步：协调器、锁、status schema 与端口定义。
 *
 * @module infra/cloud-sync
 */

export {
  CloudSyncError,
  isCloudSyncError,
} from "./errors/cloud-sync-errors.js";
export type { CloudSyncErrorCode } from "./errors/cloud-sync-errors.js";

export type { ObjectStorageHeadResult, ObjectStoragePort } from "./ports/object-storage.port.js";
export type { DbSyncPort } from "./ports/db-sync.port.js";

export {
  parseCloudSyncStatus,
  EMPTY_CLOUD_SYNC_STATUS,
} from "./model/cloud-sync-status.js";
export type { CloudSyncLock, CloudSyncStatus } from "./model/cloud-sync-status.js";

export {
  isEffectiveLock,
  canAcquireLock,
  buildLease,
  renewLease,
  DEFAULT_LEASE_SECONDS,
} from "./logic/lock.js";

export { normalizePrefix, statusKey, snapshotKey } from "./logic/paths.js";

export {
  CloudSyncCoordinator,
} from "./impl/cloud-sync-coordinator.js";
export type {
  CloudSyncCoordinatorDeps,
  PullOptions,
  PullResult,
  PushOptions,
  PushResult,
} from "./impl/cloud-sync-coordinator.js";
