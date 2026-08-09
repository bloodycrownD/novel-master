import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudSyncCoordinator } from "../../src/infra/cloud-sync/impl/cloud-sync-coordinator.js";
import { CloudSyncError } from "../../src/infra/cloud-sync/errors/cloud-sync-errors.js";
import { statusKey, snapshotKey } from "../../src/infra/cloud-sync/logic/paths.js";
import {
  PushAgentMutex,
  PushAgentMutexAcquireError,
} from "../../src/infra/cloud-sync/logic/push-agent-mutex.js";
import type { CloudSyncStatus } from "../../src/infra/cloud-sync/model/cloud-sync-status.js";
import type { DbSyncPort } from "../../src/infra/cloud-sync/ports/db-sync.port.js";
import type { ObjectStoragePort } from "../../src/infra/cloud-sync/ports/object-storage.port.js";

const PREFIX = "novel-master/sync/";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const EXPORT_PATH = "/tmp/test-export.nmbackup";
const IMPORT_PATH = "/tmp/test-import.nmbackup";

type StoredObject = {
  body: Uint8Array;
  etag: string;
};

function encodeStatus(status: CloudSyncStatus): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(status));
}

function createStorage(initial?: {
  status?: CloudSyncStatus;
  statusEtag?: string;
  snapshots?: Record<string, Uint8Array>;
}) {
  let currentStatus: CloudSyncStatus = initial?.status ?? {
    schemaVersion: 1,
    rev: 0,
    lock: null,
  };
  let currentEtag = initial?.statusEtag ?? "etag-0";
  const statusWrites: CloudSyncStatus[] = [];
  const snapshots = new Map<string, StoredObject>();
  for (const [key, body] of Object.entries(initial?.snapshots ?? {})) {
    snapshots.set(key, { body, etag: `snap-${key}` });
  }
  let etagCounter = 1;

  const storage: ObjectStoragePort & {
    getStatusWrites: () => CloudSyncStatus[];
    getSnapshots: () => Map<string, StoredObject>;
  } = {
    getStatusWrites: () => statusWrites,
    getSnapshots: () => snapshots,
    async head(key: string) {
      if (key === statusKey(PREFIX)) {
        return {
          exists: true,
          etag: currentEtag,
          bytes: encodeStatus(currentStatus).length,
        };
      }
      const snap = snapshots.get(key);
      return { exists: snap != null, etag: snap?.etag, bytes: snap?.body.length };
    },
    async get(key: string) {
      if (key === statusKey(PREFIX)) {
        return { body: encodeStatus(currentStatus), etag: currentEtag };
      }
      const snap = snapshots.get(key);
      if (snap == null) {
        throw new Error(`missing object: ${key}`);
      }
      return { body: snap.body, etag: snap.etag };
    },
    async put(key, body, options) {
      if (key === statusKey(PREFIX)) {
        if (options?.ifMatch != null && options.ifMatch !== currentEtag) {
          throw new CloudSyncError("LOCK_CONTENTION", "etag 不匹配");
        }
        const parsed = JSON.parse(new TextDecoder().decode(body)) as CloudSyncStatus;
        currentStatus = parsed;
        statusWrites.push(structuredClone(parsed));
        etagCounter += 1;
        currentEtag = `etag-${etagCounter}`;
        return { etag: currentEtag };
      }
      const newEtag = `snap-etag-${snapshots.size + 1}`;
      snapshots.set(key, { body, etag: newEtag });
      return { etag: newEtag };
    },

    async putFile(key, filePath) {
      const body = new Uint8Array(await readFile(filePath));
      return storage.put(key, body);
    },

    async getToPath(key, destPath) {
      const { body, etag } = await storage.get(key);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(destPath, body);
      return { etag };
    },
  };

  return storage;
}

function createMockDbSync(overrides?: Partial<DbSyncPort>): DbSyncPort & {
  imported: Uint8Array[];
  importedPaths: string[];
} {
  const imported: Uint8Array[] = [];
  const importedPaths: string[] = [];
  return {
    imported,
    importedPaths,
    isAgentActive: () => false,
    async exportSnapshotToPath(_destPath: string) {},
    async importSnapshot(bytes: Uint8Array) {
      imported.push(bytes);
    },
    async importSnapshotFromPath(path: string) {
      importedPaths.push(path);
    },
    ...overrides,
  };
}

function createCoordinator(
  storage: ObjectStoragePort,
  dbSync: DbSyncPort,
  options?: {
    pushMutex?: PushAgentMutex;
    pushAcquireTimeoutMs?: number;
  },
): CloudSyncCoordinator {
  const snapshotData = new Uint8Array([1, 2, 3, 4]);
  return new CloudSyncCoordinator({
    storage,
    dbSync,
    pathPrefix: PREFIX,
    deviceId: DEVICE_ID,
    exportTempPath: EXPORT_PATH,
    computeSha256Hex: (bytes) => {
      if (bytes === snapshotData || bytes.length === snapshotData.length) {
        return "abc123";
      }
      return "deadbeef";
    },
    readSnapshotBytes: async () => snapshotData,
    getSnapshotBytes: async () => snapshotData.length,
    // 显式传入新 mutex，避免模块默认单例污染其他测试
    pushMutex: options?.pushMutex ?? new PushAgentMutex(),
    pushAcquireTimeoutMs: options?.pushAcquireTimeoutMs,
  });
}

describe("CloudSyncCoordinator.pull", () => {
  it("CS-P1: remote.rev=2, local=1 拉取成功并导入", async () => {
    const snapKey = snapshotKey(PREFIX, 2);
    const snapBytes = new Uint8Array([10, 20, 30]);
    const storage = createStorage({
      status: {
        schemaVersion: 1,
        rev: 2,
        snapshotKey: snapKey,
        snapshotSha256: "deadbeef",
        snapshotBytes: snapBytes.length,
        lock: null,
      },
      snapshots: { [snapKey]: snapBytes },
    });
    const dbSync = createMockDbSync();
    const coordinator = new CloudSyncCoordinator({
      storage,
      dbSync,
      pathPrefix: PREFIX,
      deviceId: DEVICE_ID,
      exportTempPath: EXPORT_PATH,
      computeSha256Hex: () => "deadbeef",
      readSnapshotBytes: async () => new Uint8Array(),
      getSnapshotBytes: async () => 0,
    });

    const result = await coordinator.pull({ lastSyncedRev: 1 });
    assert.equal(result.rev, 2);
    assert.equal(dbSync.imported.length, 1);
    assert.deepEqual(dbSync.imported[0], snapBytes);
    assert.equal(dbSync.importedPaths.length, 0);
  });

  it("CS-P1b: 文件路径 Pull 走 getToPath + importSnapshotFromPath", async () => {
    const snapKey = snapshotKey(PREFIX, 2);
    const snapBytes = new Uint8Array([10, 20, 30]);
    const storage = createStorage({
      status: {
        schemaVersion: 1,
        rev: 2,
        snapshotKey: snapKey,
        snapshotSha256: "deadbeef",
        snapshotBytes: snapBytes.length,
        lock: null,
      },
      snapshots: { [snapKey]: snapBytes },
    });
    const dbSync = createMockDbSync();
    const importPath = join(tmpdir(), `nm-coord-pull-${Date.now()}.nmbackup`);
    const coordinator = new CloudSyncCoordinator({
      storage,
      dbSync,
      pathPrefix: PREFIX,
      deviceId: DEVICE_ID,
      exportTempPath: EXPORT_PATH,
      importTempPath: importPath,
      computeSha256Hex: () => "unused",
      hashSnapshotFile: async () => "deadbeef",
      readSnapshotBytes: async () => new Uint8Array(),
      getSnapshotBytes: async () => 0,
    });

    const result = await coordinator.pull({ lastSyncedRev: 1 });
    assert.equal(result.rev, 2);
    assert.equal(dbSync.imported.length, 0);
    assert.equal(dbSync.importedPaths.length, 1);
    assert.equal(dbSync.importedPaths[0], importPath);
    const onDisk = await readFile(importPath);
    assert.deepEqual(new Uint8Array(onDisk), snapBytes);
  });

  it("CS-P2: remote.rev=1, local=1 返回 ALREADY_UP_TO_DATE", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const coordinator = createCoordinator(storage, createMockDbSync());

    await assert.rejects(
      () => coordinator.pull({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "ALREADY_UP_TO_DATE");
        return true;
      },
    );
  });
});

describe("CloudSyncCoordinator.push", () => {
  it("CS-P3: remote.rev=2, local=1 抛出 NEED_PULL_FIRST", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 2, lock: null },
    });
    const coordinator = createCoordinator(storage, createMockDbSync());

    await assert.rejects(
      () => coordinator.push({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "NEED_PULL_FIRST");
        return true;
      },
    );
  });

  it("CS-P4: 他人有效锁时抛出 LOCK_HELD_BY_OTHER", async () => {
    const future = new Date(Date.now() + 900_000).toISOString();
    const storage = createStorage({
      status: {
        schemaVersion: 1,
        rev: 1,
        lock: {
          holderDeviceId: "other-device",
          acquiredAt: new Date().toISOString(),
          expiresAt: future,
        },
      },
    });
    const coordinator = createCoordinator(storage, createMockDbSync());

    await assert.rejects(
      () => coordinator.push({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "LOCK_HELD_BY_OTHER");
        return true;
      },
    );
  });

  it("CS-P5: Push 成功时 final status lock 为 null 且 rev 递增", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const coordinator = createCoordinator(storage, createMockDbSync());

    const result = await coordinator.push({ lastSyncedRev: 1 });
    assert.equal(result.rev, 2);

    const writes = storage.getStatusWrites();
    const finalWrite = writes[writes.length - 1];
    assert.equal(finalWrite.rev, 2);
    assert.equal(finalWrite.lock, null);
    assert.equal(finalWrite.snapshotKey, snapshotKey(PREFIX, 2));
    assert.equal(finalWrite.snapshotSha256, "abc123");
  });

  it("CS-P5b: 文件路径 Push 走 hashSnapshotFile + putFile", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const exportPath = join(tmpdir(), `nm-coord-push-${Date.now()}.nmbackup`);
    const snapBytes = new Uint8Array([1, 2, 3, 4]);
    await writeFile(exportPath, snapBytes);

    const dbSync = createMockDbSync({
      async exportSnapshotToPath(destPath: string) {
        await writeFile(destPath, snapBytes);
      },
    });

    const coordinator = new CloudSyncCoordinator({
      storage,
      dbSync,
      pathPrefix: PREFIX,
      deviceId: DEVICE_ID,
      exportTempPath: exportPath,
      computeSha256Hex: () => "unused",
      hashSnapshotFile: async () => "abc123",
      readSnapshotBytes: async () => {
        throw new Error("不应走 bytes 读路径");
      },
      getSnapshotBytes: async () => snapBytes.length,
    });

    const result = await coordinator.push({ lastSyncedRev: 1 });
    assert.equal(result.rev, 2);

    const snapKey = snapshotKey(PREFIX, 2);
    const stored = storage.getSnapshots().get(snapKey);
    assert.ok(stored != null);
    assert.deepEqual(stored.body, snapBytes);
  });

  it("CS-P6: Push 上传失败时 finally 尝试清锁", async () => {
    let currentStatus: CloudSyncStatus = {
      schemaVersion: 1,
      rev: 1,
      lock: null,
    };
    let currentEtag = "etag-0";
    const statusWrites: CloudSyncStatus[] = [];
    let etagCounter = 1;

    const storage: ObjectStoragePort & { getStatusWrites: () => CloudSyncStatus[] } = {
      getStatusWrites: () => statusWrites,
      async head(key: string) {
        if (key === statusKey(PREFIX)) {
          return { exists: true, etag: currentEtag };
        }
        return { exists: false };
      },
      async get(key: string) {
        if (key === statusKey(PREFIX)) {
          return { body: encodeStatus(currentStatus), etag: currentEtag };
        }
        throw new Error("not found");
      },
      async put(key, body, options) {
        if (key === statusKey(PREFIX)) {
          if (options?.ifMatch != null && options.ifMatch !== currentEtag) {
            throw new CloudSyncError("LOCK_CONTENTION", "etag 不匹配");
          }
          const parsed = JSON.parse(new TextDecoder().decode(body)) as CloudSyncStatus;
          currentStatus = parsed;
          statusWrites.push(structuredClone(parsed));
          etagCounter += 1;
          currentEtag = `etag-${etagCounter}`;
          return { etag: currentEtag };
        }
        throw new Error("snapshot upload failed");
      },
    };

    const coordinator = createCoordinator(storage, createMockDbSync());

    await assert.rejects(
      () => coordinator.push({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(String(error), /snapshot upload failed/);
        return true;
      },
    );

    const lockAcquire = statusWrites.find((s) => s.lock?.holderDeviceId === DEVICE_ID);
    assert.ok(lockAcquire != null, "应已抢锁");

    const clearAttempt = statusWrites.find(
      (s, i) => i > 0 && s.lock === null && s.rev === 1,
    );
    assert.ok(clearAttempt != null, "finally 应尝试清锁");
  });

  it("forceOverwriteRemote 跳过 rev 检查", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 5, lock: null },
    });
    const coordinator = createCoordinator(storage, createMockDbSync());

    const result = await coordinator.push({
      lastSyncedRev: 1,
      forceOverwriteRemote: true,
    });
    assert.equal(result.rev, 6);
  });
});

// T-SC10：进程内 push/agent 互斥锁（A-21）
describe("CloudSyncCoordinator.push 互斥锁 (A-21)", () => {
  it("T-SC10a: push 进行中启动 agent → agent 启动排队（互斥锁被 push 持有）", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const mutex = new PushAgentMutex();
    // 用 gate 让 push 在上传途中暂停，模拟“push 持锁期间 agent 启动”
    let releasePush: () => void = () => {};
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    const dbSync = createMockDbSync({
      async exportSnapshotToPath() {
        await pushGate; // 等待测试显式放行
      },
    });
    const coordinator = createCoordinator(storage, dbSync, { pushMutex: mutex });

    const pushPromise = coordinator.push({ lastSyncedRev: 1 });
    // 让 push 有机会拿到锁并进入 export
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mutex.isHeld(), true, "push 应持锁");
    assert.equal(mutex.waiterCount(), 0);

    // 模拟 agent 启动入口抢锁：应排队
    const agentAcquire = mutex.acquire({ timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mutex.waiterCount(), 1, "agent 启动应排队等待");

    // push 放行 → push 完成 → 锁释放 → agent 拿到锁
    releasePush();
    const result = await pushPromise;
    assert.equal(result.rev, 2);
    const agentHandle = await agentAcquire;
    assert.equal(mutex.isHeld(), true, "agent 应拿到锁");
    mutex.release(agentHandle);
    assert.equal(mutex.isHeld(), false);
  });

  it("T-SC10b: agent 运行中触发 push → push 排队（互斥锁被 agent 持有）", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const mutex = new PushAgentMutex();
    // 模拟 agent 启动入口先抢到锁
    const agentHandle = await mutex.acquire({ timeoutMs: 1000 });
    assert.equal(mutex.isHeld(), true);

    const coordinator = createCoordinator(storage, createMockDbSync(), {
      pushMutex: mutex,
      pushAcquireTimeoutMs: 5000,
    });

    let pushResolved = false;
    const pushPromise = coordinator
      .push({ lastSyncedRev: 1 })
      .then((r) => {
        pushResolved = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(pushResolved, false, "push 应排队等待");
    assert.equal(mutex.waiterCount(), 1);

    // agent 结束释放锁 → push 拿到锁继续
    mutex.release(agentHandle);
    const result = await pushPromise;
    assert.equal(result.rev, 2);
    assert.equal(mutex.isHeld(), false, "push 完成后锁应释放");
  });

  it("T-SC10c: push 等锁超时 → 降级拒绝（PUSH_MUTEX_TIMEOUT）", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const mutex = new PushAgentMutex();
    // 锁已被 agent 占着
    const agentHandle = await mutex.acquire({ timeoutMs: 1000 });

    const coordinator = createCoordinator(storage, createMockDbSync(), {
      pushMutex: mutex,
      pushAcquireTimeoutMs: 30, // 极短超时，快速触发降级
    });

    await assert.rejects(
      () => coordinator.push({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "PUSH_MUTEX_TIMEOUT");
        return true;
      },
    );
    assert.equal(mutex.waiterCount(), 0, "超时后应从等待队列移除");
    // 锁仍由 agent 持有，不受 push 超时影响
    assert.equal(mutex.isHeld(), true);
    mutex.release(agentHandle);
  });

  it("T-SC10d: 并发 push 请求 → 互斥（第二个 push 等第一个完成）", async () => {
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    const mutex = new PushAgentMutex();
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered = false;
    let secondStarted = false;
    const dbSync = createMockDbSync({
      async exportSnapshotToPath(destPath: string) {
        if (!firstEntered) {
          firstEntered = true;
          await firstGate;
        } else {
          secondStarted = true;
        }
      },
    });
    const coordinator = createCoordinator(storage, dbSync, { pushMutex: mutex });

    const first = coordinator.push({ lastSyncedRev: 1 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mutex.isHeld(), true, "第一个 push 持锁");

    // 第二个 push 并发进来：应排队（不会进入 export）
    const second = coordinator
      .push({ lastSyncedRev: 1, forceOverwriteRemote: true })
      .then((r) => {
        assert.equal(secondStarted, true, "第二个 push 在第一个释放后才进入 export");
        return r;
      });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(secondStarted, false, "第二个 push 不应提前进入 export");
    assert.equal(mutex.waiterCount(), 1);

    releaseFirst();
    const firstResult = await first;
    assert.equal(firstResult.rev, 2);
    // 第二个 push 用 forceOverwriteRemote 跳过 rev 检查（第一个已完成把 remote 推到 rev=2）
    const secondResult = await second;
    assert.equal(secondResult.rev, 3, "第二个 push 接着第一个的 rev 递增");
    assert.equal(mutex.isHeld(), false, "两个 push 都完成后锁应释放");
  });

  it("T-SC10e: 续租点检测到 agent 抢跑 → 拒绝并清云端锁", async () => {
    // 这个用例覆盖 apps runtime 未接入互斥锁的兼容场景：
    // agent 不走 mutex 直接启动，靠续租点的 isAgentActive 复检兜底拒绝
    const storage = createStorage({
      status: { schemaVersion: 1, rev: 1, lock: null },
    });
    let agentActive = false;
    const dbSync = createMockDbSync({
      isAgentActive: () => agentActive,
      async exportSnapshotToPath() {
        // push 导出期间 agent 抢跑
        agentActive = true;
      },
    });
    const coordinator = createCoordinator(storage, dbSync);

    await assert.rejects(
      () => coordinator.push({ lastSyncedRev: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof CloudSyncError);
        assert.equal(error.code, "AGENT_ACTIVE");
        return true;
      },
    );

    // 续租点拒绝后，云端锁应被 finally 清掉
    const writes = storage.getStatusWrites();
    const lockAcquired = writes.find((s) => s.lock?.holderDeviceId === DEVICE_ID);
    assert.ok(lockAcquired != null, "应已抢云端锁");
    const clearAttempt = writes.find(
      (s, i) => i > 0 && s.lock === null && s.rev === 1,
    );
    assert.ok(clearAttempt != null, "拒绝后应尝试清云端锁");
  });
});

describe("PushAgentMutex 单元", () => {
  it("acquire/release 基本互斥", async () => {
    const m = new PushAgentMutex();
    const h1 = await m.acquire({ timeoutMs: 1000 });
    assert.equal(m.isHeld(), true);
    const h2Promise = m.acquire({ timeoutMs: 1000 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(m.waiterCount(), 1);
    m.release(h1);
    const h2 = await h2Promise;
    assert.equal(m.isHeld(), true);
    m.release(h2);
    assert.equal(m.isHeld(), false);
  });

  it("非持锁者 release 安全忽略", async () => {
    const m = new PushAgentMutex();
    const h1 = await m.acquire({ timeoutMs: 1000 });
    const fakeHandle = { id: 99999, acquiredAt: 0 };
    m.release(fakeHandle); // 不应影响持锁
    assert.equal(m.isHeld(), true);
    m.release(h1);
    assert.equal(m.isHeld(), false);
  });

  it("超时抛 PushAgentMutexAcquireError", async () => {
    const m = new PushAgentMutex();
    await m.acquire({ timeoutMs: 1000 });
    await assert.rejects(
      () => m.acquire({ timeoutMs: 20 }),
      (error: unknown) => {
        assert.ok(error instanceof PushAgentMutexAcquireError);
        assert.equal(error.code, "TIMEOUT");
        return true;
      },
    );
  });
});
