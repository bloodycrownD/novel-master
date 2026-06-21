import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudSyncCoordinator } from "../../src/infra/cloud-sync/impl/cloud-sync-coordinator.js";
import { CloudSyncError } from "../../src/infra/cloud-sync/errors/cloud-sync-errors.js";
import { statusKey, snapshotKey } from "../../src/infra/cloud-sync/logic/paths.js";
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
