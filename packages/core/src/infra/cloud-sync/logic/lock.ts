/**
 * 云同步租约锁：有效判定、抢占与续租。
 *
 * @module infra/cloud-sync/logic/lock
 */

import type { CloudSyncLock } from "../model/cloud-sync-status.js";

/** 默认租约时长（秒） */
export const DEFAULT_LEASE_SECONDS = 900;

/**
 * 锁是否仍有效：`lock != null` 且 `expiresAt` 未过期。
 */
export function isEffectiveLock(lock: CloudSyncLock | null): boolean {
  if (lock == null) {
    return false;
  }
  return Date.parse(lock.expiresAt) > Date.now();
}

/**
 * 当前设备是否可抢占锁：无有效锁，或有效锁持有人为本机。
 */
export function canAcquireLock(
  lock: CloudSyncLock | null,
  deviceId: string,
): boolean {
  if (!isEffectiveLock(lock)) {
    return true;
  }
  return lock!.holderDeviceId === deviceId;
}

/**
 * 为本机构建新租约锁。
 */
export function buildLease(
  deviceId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): CloudSyncLock {
  const now = Date.now();
  return {
    holderDeviceId: deviceId,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + leaseSeconds * 1000).toISOString(),
  };
}

/**
 * 续租：保留持有人与获取时间，将 `expiresAt` 延长至当前时刻 + `leaseSeconds`。
 */
export function renewLease(
  lock: CloudSyncLock,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): CloudSyncLock {
  return {
    holderDeviceId: lock.holderDeviceId,
    acquiredAt: lock.acquiredAt,
    expiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
  };
}
