/**
 * T-S16（取消侧）：CloudSyncCoordinator 的阶段边界检查点。
 *
 * 云同步是**阶段级取消**（S3 单次传输没有 abort 面），所以检查点只落在真实
 * 阶段边界：pull 的「入口 / 下载完成（哈希前）/ 换库前」与 push 的
 * 「入口 / 快照导出后 / 上传前」，两条 pull import 分支都要覆盖。
 *
 * 命中即抛 AbortError（Promise 只有 reject 通道）；service 出口对
 * `isAbortLikeError` 原样上抛。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudSyncCoordinator } from "../../src/infra/cloud-sync/impl/cloud-sync-coordinator.js";
import type { CloudSyncCoordinatorDeps, PullOptions, PushOptions } from "../../src/infra/cloud-sync/impl/cloud-sync-coordinator.js";
import { Result } from "../../src/errors/either.js";
import { isAbortLikeError } from "../../src/infra/llm-protocol/logic/request-abort.js";
import { PushAgentMutex } from "../../src/infra/cloud-sync/logic/push-agent-mutex.js";
import { snapshotKey, statusKey } from "../../src/infra/cloud-sync/logic/paths.js";
import type { CloudSyncStatus } from "../../src/infra/cloud-sync/model/cloud-sync-status.js";
import type { DbSyncPort } from "../../src/infra/cloud-sync/ports/db-sync.port.js";
import type { ObjectStoragePort } from "../../src/infra/cloud-sync/ports/object-storage.port.js";

const PREFIX = "novel-master/sync/";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const SNAP_KEY = snapshotKey(PREFIX, 2);
const SNAP_BYTES = new Uint8Array([1, 2, 3, 4]);
const EXPORT_PATH = join(tmpdir(), `nm-coord-checkpoint-export-${process.pid}.nmbackup`);
const IMPORT_PATH = join(tmpdir(), `nm-coord-checkpoint-import-${process.pid}.nmbackup`);

function remoteStatusAtRev2(): CloudSyncStatus {
  return { schemaVersion: 1, rev: 2, snapshotKey: SNAP_KEY, snapshotSha256: "hash-ok", snapshotBytes: SNAP_BYTES.length, lock: null };
}

function remoteStatusAtRev0(): CloudSyncStatus {
  return { schemaVersion: 1, rev: 0, lock: null };
}

function encodeStatus(status: CloudSyncStatus): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(status));
}

/** 记录阶段事件的内存存储；事件顺序是「检查点确实落在真实边界」的观测面。 */
function createStorage(events: string[], options?: { fileDownload?: boolean; initialStatus?: CloudSyncStatus }): ObjectStoragePort {
  let currentStatus = options?.initialStatus ?? remoteStatusAtRev2();
  let currentEtag = "etag-0";
  const fileDownload = options?.fileDownload === true;
  return {
    async head(key) {
      if (key === statusKey(PREFIX)) {
        return { exists: true, etag: currentEtag };
      }
      return { exists: key === SNAP_KEY };
    },
    async get(key) {
      if (key === statusKey(PREFIX)) {
        events.push("get:status");
        return { body: encodeStatus(currentStatus), etag: currentEtag };
      }
      events.push("get:snap");
      return { body: SNAP_BYTES, etag: "snap-etag" };
    },
    async put(key, body) {
      if (key === statusKey(PREFIX)) {
        events.push("put:status");
        currentStatus = JSON.parse(new TextDecoder().decode(body)) as CloudSyncStatus;
        currentEtag = `etag-${events.length}`;
        return Result.ok({ etag: currentEtag });
      }
      events.push("put:snap");
      return Result.ok({ etag: "snap-etag" });
    },
    ...(fileDownload
      ? {
          async putFile(_key: string) {
            events.push("putFile");
            return Result.ok({ etag: "snap-etag" });
          },
          async getToPath(_key: string, destPath: string) {
            events.push("getToPath");
            await writeFile(destPath, SNAP_BYTES);
            return Result.ok({ etag: "snap-etag" });
          },
        }
      : {}),
  };
}

function createDbSync(events: string[]): DbSyncPort {
  return {
    isAgentActive: () => false,
    async exportSnapshotToPath() {
      events.push("export");
    },
    async importSnapshot() {
      events.push("import:bytes");
      return Result.ok({ databaseReplaced: true });
    },
    async importSnapshotFromPath() {
      events.push("import:path");
      return Result.ok({ databaseReplaced: true });
    },
  };
}

/**
 * 第 `interruptAt` 次调用返回 `Interrupt`，其余返回 null。
 *
 * 次数是绝对调用序号——它把「检查点总量」也钉住了：多插/漏插都会让后续
 * 断言的事件序列错位。
 */
function scriptedCheckpoint(events: string[], interruptAt: number): () => { kind: "cancelled"; reason: "user-stop" } | null {
  let calls = 0;
  return () => {
    calls += 1;
    events.push(`checkpoint:${calls}`);
    return calls === interruptAt ? { kind: "cancelled" as const, reason: "user-stop" as const } : null;
  };
}

type CoordinatorOverrides = Partial<CloudSyncCoordinatorDeps>;

function createCoordinator(events: string[], storage: ObjectStoragePort, overrides?: CoordinatorOverrides): CloudSyncCoordinator {
  return new CloudSyncCoordinator({
    storage,
    dbSync: createDbSync(events),
    pathPrefix: PREFIX,
    deviceId: DEVICE_ID,
    exportTempPath: EXPORT_PATH,
    computeSha256Hex: () => {
      events.push("hash:bytes");
      return "hash-ok";
    },
    readSnapshotBytes: async () => {
      events.push("read:snapshot");
      return SNAP_BYTES;
    },
    getSnapshotBytes: async () => {
      events.push("size");
      return SNAP_BYTES.length;
    },
    pushMutex: new PushAgentMutex(),
    ...overrides,
  });
}

function filePathDeps(events: string[]): CoordinatorOverrides {
  return {
    importTempPath: IMPORT_PATH,
    hashSnapshotFile: async () => {
      events.push("hash:file");
      return "hash-ok";
    },
  };
}

async function rejectsAsAbort(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(isAbortLikeError(error), `expected AbortError, got ${String(error)}`);
    return true;
  });
}

describe("CloudSyncCoordinator.pull 阶段边界检查点", () => {
  it("文件路径分支：下载完成后（哈希前）命中 → 不哈希、不换库", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events, { fileDownload: true }), filePathDeps(events));
    await rejectsAsAbort(() => coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 2) }));
    assert.deepEqual(events, ["checkpoint:1", "get:status", "getToPath", "checkpoint:2"]);
  });

  it("文件路径分支：哈希后换库前命中 → 不调用 importSnapshotFromPath", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events, { fileDownload: true }), filePathDeps(events));
    await rejectsAsAbort(() => coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 3) }));
    assert.deepEqual(events, ["checkpoint:1", "get:status", "getToPath", "checkpoint:2", "hash:file", "checkpoint:3"]);
  });

  it("文件路径分支：不注入检查点或未命中时照常完成（检查点不改变成功语义）", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events, { fileDownload: true }), filePathDeps(events));
    const pulled = await coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 99) });
    assert.ok(pulled.ok);
    assert.equal(pulled.value.rev, 2);
    assert.ok(events.includes("import:path"));
  });

  it("字节分支：下载完成后（哈希前）命中 → 不哈希、不换库", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events));
    await rejectsAsAbort(() => coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 2) }));
    assert.deepEqual(events, ["checkpoint:1", "get:status", "get:snap", "checkpoint:2"]);
  });

  it("字节分支：哈希后换库前命中 → 不调用 importSnapshot", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events));
    await rejectsAsAbort(() => coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 3) }));
    assert.deepEqual(events, ["checkpoint:1", "get:status", "get:snap", "checkpoint:2", "hash:bytes", "checkpoint:3"]);
  });

  it("入口命中 → 连远端状态都不读", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events));
    await rejectsAsAbort(() => coordinator.pull({ lastSyncedRev: 1, checkpoint: scriptedCheckpoint(events, 1) }));
    assert.deepEqual(events, ["checkpoint:1"]);
  });
});

describe("CloudSyncCoordinator.push 阶段边界检查点", () => {
  function pushOptions(events: string[], interruptAt: number): PushOptions {
    return { lastSyncedRev: 0, checkpoint: scriptedCheckpoint(events, interruptAt) };
  }

  it("快照导出后命中 → 不哈希、不上传", async () => {
    const events: string[] = [];
    const storage = createStorage(events, { fileDownload: true, initialStatus: remoteStatusAtRev0() });
    const coordinator = createCoordinator(events, storage, {
      hashSnapshotFile: async () => {
        events.push("hash:file");
        return "hash-ok";
      },
    });
    await rejectsAsAbort(() => coordinator.push(pushOptions(events, 2)));
    // 命中之后的 finally 会尽力清云端锁（get:status/put:status），不在本条断言面内。
    assert.deepEqual(events.slice(0, 6), ["checkpoint:1", "get:status", "put:status", "export", "size", "checkpoint:2"]);
    assert.ok(!events.includes("hash:file"));
    assert.ok(!events.includes("putFile"));
  });

  it("上传前命中 → 已算哈希但不发起上传", async () => {
    const events: string[] = [];
    const storage = createStorage(events, { fileDownload: true, initialStatus: remoteStatusAtRev0() });
    const coordinator = createCoordinator(events, storage, {
      hashSnapshotFile: async () => {
        events.push("hash:file");
        return "hash-ok";
      },
    });
    await rejectsAsAbort(() => coordinator.push(pushOptions(events, 3)));
    assert.deepEqual(events.slice(0, 8), ["checkpoint:1", "get:status", "put:status", "export", "size", "checkpoint:2", "hash:file", "checkpoint:3"]);
    assert.ok(!events.includes("putFile"));
  });

  it("字节分支上传前命中同样生效", async () => {
    const events: string[] = [];
    const storage = createStorage(events, { initialStatus: remoteStatusAtRev0() });
    const coordinator = createCoordinator(events, storage);
    await rejectsAsAbort(() => coordinator.push(pushOptions(events, 3)));
    assert.deepEqual(events.slice(0, 9), ["checkpoint:1", "get:status", "put:status", "export", "size", "checkpoint:2", "read:snapshot", "hash:bytes", "checkpoint:3"]);
    assert.ok(!events.includes("put:snap"));
  });

  it("检查点未命中时照常推送（阶段边界不改变成功语义）", async () => {
    const events: string[] = [];
    const coordinator = createCoordinator(events, createStorage(events, { fileDownload: true, initialStatus: remoteStatusAtRev0() }), {
      hashSnapshotFile: async () => "hash-ok",
    });
    const pushed = await coordinator.push(pushOptions(events, 99));
    assert.ok(pushed.ok);
    assert.equal(pushed.value.rev, 1);
    assert.ok(events.includes("putFile"));
  });
});

/** 编译期 pin：检查点是可选字段（未注入的调用方零改动）。 */
const _optionalCheckpoint: PullOptions = { lastSyncedRev: 0 };
void _optionalCheckpoint;
