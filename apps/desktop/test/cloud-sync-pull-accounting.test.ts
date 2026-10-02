/**
 * Desktop 云同步 pull 的记账与换代时序（S-CS-01 / S-CS-16 / D5）。
 *
 * P0 的病症：`coordinator.pull()` 内部换库并关掉了本进程那条连接，`pull()`
 * 紧接着用**构造期绑定**的 configStore 写 lastSyncedRev ⇒ 必抛
 * CONNECTION_CLOSED；抛错发生在 recordPull 之前，于是 UI 记成「拉取失败」而库
 * 其实已经换掉，且 lastSyncedRev 永不推进 ⇒ 反复拉同一 rev。
 *
 * 这里用「真库 + 内存版远端」做端到端断言：desktop 测试基座是 node:test 零 mock
 * 设施，S3 客户端是在 buildCoordinator 内部现场构造的，所以生产代码上留了
 * `__setDesktopCloudSyncStorageOverrideForTest` 这个注入点。
 *
 * @module test/cloud-sync-pull-accounting
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { normalizePrefix, snapshotKey, statusKey, type ObjectStoragePort } from "@novel-master/core";
import {
  __setDesktopCloudSyncStorageOverrideForTest,
  resetDesktopCloudSyncServiceForTest,
} from "../src/main/services/cloud-sync.service.js";
import { exportDatabaseBackupToPath } from "../src/main/services/db-backup.service.js";
import {
  handleCloudSyncGetLocalStatus,
  handleCloudSyncPull,
  handleCloudSyncSetConfig,
} from "../src/main/ipc/handlers/cloud-sync.js";
import {
  getDesktopRuntime,
} from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

const PREFIX = "novel-master/sync/";

/** 内存版远端：只实现 coordinator.pull 走的那几个面。 */
function createMemoryRemote(initial: {
  rev: number;
  snapshot: Uint8Array;
  sha256: string;
}): ObjectStoragePort {
  const status: Record<string, unknown> = {
    schemaVersion: 1,
    rev: initial.rev,
    snapshotKey: snapshotKey(PREFIX, initial.rev),
    snapshotSha256: initial.sha256,
    snapshotBytes: initial.snapshot.length,
    lock: null,
  };
  let etag = "etag-1";
  const encode = (): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(status));
  return {
    async head(key: string) {
      if (key === statusKey(PREFIX)) {
        return { exists: true, etag, bytes: encode().length };
      }
      return { exists: false };
    },
    async get(key: string) {
      if (key === statusKey(PREFIX)) {
        return { body: encode(), etag };
      }
      return { body: initial.snapshot, etag: "snap-1" };
    },
    async put() {
      etag = `etag-${Number(etag.slice(4)) + 1}`;
      return { etag };
    },
    async putFile() {
      return { etag: "snap-etag" };
    },
    async getToPath(key: string, destPath: string) {
      await writeFile(destPath, initial.snapshot);
      return { etag: (await this.get(key)).etag };
    },
  };
}

describe("cloud-sync pull 记账与换代时序 (S-CS-01 / S-CS-16 / D5)", () => {
  let tempDir: string;
  let revCounter = 2;

  /** 导出一份真实快照，登记到内存远端上，返回快照路径。 */
  async function publishRemote(label: string): Promise<void> {
    const runtime = await getDesktopRuntime();
    const snapshotPath = join(tempDir, `remote-${label}.nmbackup`);
    await exportDatabaseBackupToPath(runtime, snapshotPath);
    const snapshot = new Uint8Array(await readFile(snapshotPath));
    const sha256 = createHash("sha256").update(snapshot).digest("hex");
    revCounter += 1;
    resetDesktopCloudSyncServiceForTest();
    __setDesktopCloudSyncStorageOverrideForTest(
      createMemoryRemote({ rev: revCounter, snapshot, sha256 })
    );
  }

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-pull-accounting-"));
    resetDesktopCloudSyncServiceForTest();
    const saved = await handleCloudSyncSetConfig({
      endpoint: "https://s3.example.com",
      bucket: "test-bucket",
      region: "",
      pathPrefix: normalizePrefix(PREFIX),
      accessKeyId: "test-ak",
      secretAccessKey: "test-sk",
      forcePathStyle: true,
      deviceLabel: "测试设备",
    });
    assert.equal(saved.ok, true);
  });

  after(async () => {
    __setDesktopCloudSyncStorageOverrideForTest(null);
    resetDesktopCloudSyncServiceForTest();
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("pull 成功后 lastSyncedRev 推进且第二次 pull 命中 ALREADY_UP_TO_DATE", async () => {
    await publishRemote("rev2");
    const expectedRev = revCounter;
    const before = await getDesktopRuntime();

    const first = await handleCloudSyncPull();
    assert.equal(
      first.ok,
      true,
      `首次 pull 必须成功（基线上这里是 CONNECTION_CLOSED）: ${JSON.stringify(first)}`,
    );
    if (first.ok) {
      assert.equal(first.data.databaseReplaced, true);
    }

    // 换库之后 runtime 必须已换代。
    const afterPull = await getDesktopRuntime();
    assert.notEqual(afterPull, before, "换库后 runtime 必须换代");

    const status = await handleCloudSyncGetLocalStatus();
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(
        status.data.lastSyncedRev,
        expectedRev,
        "lastSyncedRev 必须推进",
      );
      assert.match(
        status.data.lastPullResult ?? "",
        /^成功.*rev \d+$/,
        `拉取结果必须以「成功」开头（基线上这里是 CONNECTION_CLOSED 记成失败）: ${status.data.lastPullResult}`,
      );
    }

    // 「rev 永不推进」这条主症状的直接反证：第二次 pull 不该再拉一遍同一 rev。
    const second = await handleCloudSyncPull();
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(
        second.data.databaseReplaced,
        false,
        "ALREADY_UP_TO_DATE 早返回时库没换、连接没关",
      );
    }
    const status2 = await handleCloudSyncGetLocalStatus();
    assert.equal(status2.ok, true);
    if (status2.ok) {
      assert.equal(status2.data.lastPullResult, "成功：已是最新");
      assert.equal(status2.data.lastSyncedRev, expectedRev);
    }
  });

  it("ALREADY_UP_TO_DATE 早返回不换代（runtime 对象身份不变）", async () => {
    // 同源可观测面：不用 spy（handler 对 rebootstrapDesktopRuntime 是 ESM 具名
    // 导入，node:test 基座没有可注入缝），改断言 runtime 身份——rebootstrap 必然
    // 产生新对象，身份不变恰好抓住「不该 rebuild 却 rebuild 了」的回归方向。
    // 远端 rev 未前进 ⇒ 必走 ALREADY_UP_TO_DATE。
    resetDesktopCloudSyncServiceForTest();
    __setDesktopCloudSyncStorageOverrideForTest(
      createMemoryRemote({ rev: revCounter, snapshot: new Uint8Array([0]), sha256: "x" })
    );

    const before = await getDesktopRuntime();
    const result = await handleCloudSyncPull();
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await getDesktopRuntime();
    assert.equal(
      after,
      before,
      "已是最新路径上不得 rebootstrap（白白关连接 + 重建整条 service graph）",
    );
  });

  it("正常 pull 时先换代再记账（记账句柄必须是活连接）", async () => {
    await publishRemote("rev3");
    const expectedRev = revCounter;

    const result = await handleCloudSyncPull();
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.data.databaseReplaced, true);
    }
    const status = await handleCloudSyncGetLocalStatus();
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.data.lastSyncedRev, expectedRev);
    }
  });

  it("DatabaseReplacedError 仍完成 runtime 换代（catch 分支的 G1 断言）", async () => {
    // 先往本机 llm_provider 塞一行「非法」数据（display_name 为空，schema 层
    // 没有 CHECK 拦它，但 service 级校验会拒）。于是：
    //   覆盖动作成功（库已换代、库文件本身是合法 sqlite）
    // → 恢复三表前 validateProviderTableSnapshot 抛错
    // → coordinator 原样透传 DatabaseReplacedError。
    // 「库已换却不重建」比「记账失败」更糟，所以 catch 分支必须先换代再报错。
    const runtime = await getDesktopRuntime();
    await runtime.conn.execute(
      "INSERT INTO llm_provider (id, protocol, base_url, display_name, is_builtin, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 0, 1, 1)",
      ["rollback-illegal-provider", "openai", "https://example.invalid", ""],
    );
    await publishRemote("rev4");

    const before = await getDesktopRuntime();
    const result = await handleCloudSyncPull();

    assert.equal(result.ok, false, "收尾失败应回报失败");
    if (!result.ok) {
      assert.match(
        result.error.message,
        /服务商配置恢复失败/,
        "失败信息必须可读且带上 providerTablesRestored",
      );
    }
    const after = await getDesktopRuntime();
    assert.notEqual(
      after,
      before,
      "catch 分支必须先换代再报错（库已换却不重建比记账失败更糟）",
    );
    // 换代后的 runtime 必须可用（能读状态）——否则这个「换代」是假的。
    const status = await handleCloudSyncGetLocalStatus();
    assert.equal(status.ok, true);
  });
});
