import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {CloudSyncService, syncBusy} from "../src/main/services/cloud-sync.service.js";
import type { CloudSyncConfigStore } from "../src/main/services/cloud-sync-config.store.js";
import { CloudSync } from "../src/main/ipc/handlers/cloud-sync.js";
import {
    setupDesktopDbTestEnv,
    teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("cloud-sync ipc handlers", () => {
    let tempDir: string;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-cloud-sync-"));
        CloudSyncService.resetForTest();
    });

    after(async () => {
        CloudSyncService.resetForTest();
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("getConfig 在未配置时返回空字段", async () => {
        const result = await CloudSync.getConfig();
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.data.endpoint, "");
            assert.equal(result.data.hasSecretKey, false);
            assert.equal(result.data.enabled, false);
        }
    });

    it("setConfig 与 getLocalStatus 可往返", async () => {
        const saved = await CloudSync.setConfig({
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

        const config = await CloudSync.getConfig();
        assert.equal(config.ok, true);
        if (config.ok) {
            assert.equal(config.data.bucket, "test-bucket");
            assert.equal(config.data.hasSecretKey, true);
            assert.equal(config.data.enabled, true);
            assert.equal(config.data.deviceLabel, "测试设备");
            assert.ok(config.data.deviceId.length > 0);
        }

        const status = await CloudSync.getLocalStatus();
        assert.equal(status.ok, true);
        if (status.ok) {
            assert.equal(status.data.configured, true);
            assert.equal(status.data.lastSyncedRev, 0);
            assert.equal(status.data.deviceLabel, "测试设备");
        }

        const disabled = await CloudSync.setEnabled(false);
        assert.equal(disabled.ok, true);

        const afterDisable = await CloudSync.getLocalStatus();
        assert.equal(afterDisable.ok, true);
        if (afterDisable.ok) {
            assert.equal(afterDisable.data.configured, false);
        }

        const configAfter = await CloudSync.getConfig();
        assert.equal(configAfter.ok, true);
        if (configAfter.ok) {
            assert.equal(configAfter.data.enabled, false);
            assert.equal(configAfter.data.bucket, "test-bucket");
        }
    });

    it("同一 runtime 连续两次 getDesktopCloudSyncService 返回同一实例", async () => {
        // 守住「不每次都重建」这条回归（S-CS-02）：换代判据是 runtime 对象身份，
        // 不是调用次数 —— 否则每次 IPC 都会丢掉 syncBusy 计数与 configStore 缓存。
        const s1R = await CloudSyncService.get();
        if (!s1R.ok) throw s1R.error;
        const s1 = s1R.value;
        const s2R = await CloudSyncService.get();
        if (!s2R.ok) throw s2R.error;
        const s2 = s2R.value;
        assert.equal(s1, s2, "同一代 runtime 不得反复重建 service");
    });

    it("pull 前置 getLocalMeta 抛错后 syncBusy 复位 false", async () => {
        // MF-4（desktop/B-3）回归：getLocalMeta 移入 try 后，任何抛错路径都
        // 必须经 finally 复位 syncBusy——否则数据清理守卫会被永久锁死。
        const serviceR = await CloudSyncService.get();
        if (!serviceR.ok) throw serviceR.error;
        const service = serviceR.value;
        const configStore = (
            service as unknown as {
                configStore: CloudSyncConfigStore;
            }
        ).configStore;
        const originalGetLocalMeta = configStore.getLocalMeta.bind(configStore);
        configStore.getLocalMeta = async () => {
            throw new Error("meta 读失败（注入）");
        };
        try {
            await assert.rejects(service.pull(), /meta 读失败（注入）/);
        } finally {
            configStore.getLocalMeta = originalGetLocalMeta;
        }
        assert.equal(syncBusy.isBusy(), false);
    });
});
