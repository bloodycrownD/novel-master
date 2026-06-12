import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLease,
  canAcquireLock,
  isEffectiveLock,
  renewLease,
} from "../../src/infra/cloud-sync/logic/lock.js";
import type { CloudSyncLock } from "../../src/infra/cloud-sync/model/cloud-sync-status.js";

const DEVICE_A = "device-a";
const DEVICE_B = "device-b";

function expiredLock(holder: string): CloudSyncLock {
  const past = new Date(Date.now() - 60_000).toISOString();
  return {
    holderDeviceId: holder,
    acquiredAt: past,
    expiresAt: past,
  };
}

function activeLock(holder: string, ttlMs = 900_000): CloudSyncLock {
  const now = Date.now();
  return {
    holderDeviceId: holder,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

describe("cloud-sync lock", () => {
  it("CS-L1: 他人有效锁时不可抢占", () => {
    const lock = activeLock(DEVICE_B);
    assert.equal(isEffectiveLock(lock), true);
    assert.equal(canAcquireLock(lock, DEVICE_A), false);
    assert.equal(canAcquireLock(lock, DEVICE_B), true);
  });

  it("CS-L2: 锁过期后可抢占", () => {
    const lock = expiredLock(DEVICE_B);
    assert.equal(isEffectiveLock(lock), false);
    assert.equal(canAcquireLock(lock, DEVICE_A), true);
  });

  it("buildLease 生成有效租约", () => {
    const lease = buildLease(DEVICE_A, 900);
    assert.equal(lease.holderDeviceId, DEVICE_A);
    assert.equal(isEffectiveLock(lease), true);
    assert.ok(Date.parse(lease.expiresAt) > Date.parse(lease.acquiredAt));
  });

  it("renewLease 延长 expiresAt", () => {
    const lease = buildLease(DEVICE_A, 900);
    const renewed = renewLease(lease, 900);
    assert.equal(renewed.holderDeviceId, DEVICE_A);
    assert.equal(renewed.acquiredAt, lease.acquiredAt);
    assert.ok(Date.parse(renewed.expiresAt) >= Date.parse(lease.expiresAt));
  });
});
