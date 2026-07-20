import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetDesktopRuntimeForTest } from "../src/main/runtime/desktop-runtime-singleton.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import { handleEventsGetConfig } from "../src/main/ipc/handlers/events-config-handlers.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("events IPC handlers", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-events-handlers-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-IPC2：invalid wire 时返回 assessed invalid health", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    const brokenWire = { schemaVersion: 1, events: {} };
    await rt.conn.execute(
      `INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
      ["nm-events", "config", JSON.stringify(brokenWire)],
    );
    await resetDesktopRuntimeForTest();

    const result = await handleEventsGetConfig();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.data.status, "invalid");
    if (result.data.status === "invalid") {
      assert.ok(result.data.code);
      assert.ok(result.data.message);
    }
  });

  it("T-X1-1：清空后 get 返回 assessed valid（默认配置）", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    await rt.eventsConfig.clearConfig();
    await resetDesktopRuntimeForTest();

    const result = await handleEventsGetConfig();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.data.status, "valid");
    if (result.data.status === "valid") {
      assert.equal(result.data.value.schemaVersion, 2);
    }
  });
});
