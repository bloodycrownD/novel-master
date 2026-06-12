/**
 * 云同步 IPC 处理器集成测试（空库配置读写）。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import {
  handleCloudSyncGetConfig,
  handleCloudSyncGetLocalStatus,
  handleCloudSyncSetConfig,
  handleCloudSyncSetEnabled,
} from "../src/main/ipc/handlers/cloud-sync.js";
import { resetDesktopCloudSyncServiceForTest } from "../src/main/services/cloud-sync.service.js";

describe("cloud-sync ipc handlers", () => {
  let tempDir: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-desktop-cloud-sync-"));
    process.env.NOVEL_MASTER_DB = join(tempDir, "novel.db");
    resetDesktopCloudSyncServiceForTest();
  });

  after(async () => {
    resetDesktopCloudSyncServiceForTest();
    await closeDesktopConnection();
    delete process.env.NOVEL_MASTER_DB;
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(false);
    } else {
      setDpapiTestPassthrough(false);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getConfig 在未配置时返回空字段", async () => {
    const result = await handleCloudSyncGetConfig();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.endpoint, "");
      assert.equal(result.data.hasSecretKey, false);
      assert.equal(result.data.enabled, false);
    }
  });

  it("setConfig 与 getLocalStatus 可往返", async () => {
    const saved = await handleCloudSyncSetConfig({
      endpoint: "https://s3.example.com",
      bucket: "test-bucket",
      region: "",
      pathPrefix: "novel-master/sync/",
      accessKeyId: "test-ak",
      secretAccessKey: "test-sk",
      forcePathStyle: true,
      deviceLabel: "测试设备",
    });
    assert.equal(saved.ok, true);

    const config = await handleCloudSyncGetConfig();
    assert.equal(config.ok, true);
    if (config.ok) {
      assert.equal(config.data.bucket, "test-bucket");
      assert.equal(config.data.hasSecretKey, true);
      assert.equal(config.data.enabled, true);
      assert.equal(config.data.deviceLabel, "测试设备");
      assert.ok(config.data.deviceId.length > 0);
    }

    const status = await handleCloudSyncGetLocalStatus();
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.data.configured, true);
      assert.equal(status.data.lastSyncedRev, 0);
      assert.equal(status.data.deviceLabel, "测试设备");
    }

    const disabled = await handleCloudSyncSetEnabled(false);
    assert.equal(disabled.ok, true);

    const afterDisable = await handleCloudSyncGetLocalStatus();
    assert.equal(afterDisable.ok, true);
    if (afterDisable.ok) {
      assert.equal(afterDisable.data.configured, false);
    }

    const configAfter = await handleCloudSyncGetConfig();
    assert.equal(configAfter.ok, true);
    if (configAfter.ok) {
      assert.equal(configAfter.data.enabled, false);
      assert.equal(configAfter.data.bucket, "test-bucket");
    }
  });
});
