/**
 * 跨端云同步：协调器、锁、status schema、端口定义与导入换代哨兵。
 *
 * @module infra/cloud-sync
 */

export type {
  ObjectStorageHeadResult,
  ObjectStoragePort,
} from "./ports/object-storage.port.js";
export type { DbSyncPort } from "./ports/db-sync.port.js";

export {
  CloudSyncStatusParser,
  EMPTY_CLOUD_SYNC_STATUS,
} from "./model/cloud-sync-status.js";
export type {
  CloudSyncLock,
  CloudSyncStatus,
} from "./model/cloud-sync-status.js";
export type { CloudSyncConfigInput } from "./model/cloud-sync-config.js";
export { DatabaseReplacedError } from "./model/database-replaced-error.js";

export {
  CloudSyncLease,
  DEFAULT_LEASE_SECONDS,
} from "./logic/lock.js";

export { CloudSyncPaths } from "./logic/paths.js";

export { CloudSyncCoordinator, DefaultPushAgentMutex } from "./impl/cloud-sync-coordinator.js";
export type {
  CloudSyncCoordinatorDeps,
  PullOptions,
  PullResult,
  PushOptions,
  PushResult,
} from "./impl/cloud-sync-coordinator.js";
