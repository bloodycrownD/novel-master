import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import { DesktopRuntimeFactory } from "../src/main/runtime/create-desktop-runtime.js";
import { DesktopSksp } from "../src/main/runtime/register-platform-drivers.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("createDesktopNovelMasterRuntime", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-runtime-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("registers the platform SKSP driver", () => {
    const name = DesktopSksp.registerDriver();
    assert.ok(name.ok, "桌面三平台均受支持，不应失败");
    if (process.platform === "darwin") {
      assert.equal(name.value, "macos");
    } else if (process.platform === "linux") {
      assert.equal(name.value, "linux");
    } else {
      assert.equal(name.value, "windows");
    }
  });

  it("bootstraps SQLite and supports project.create smoke", async () => {
    // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
    const runtimeR = await DesktopRuntimeFactory.create();
    if (!runtimeR.ok) throw runtimeR.error;
    const runtime = runtimeR.value;
    assert.ok(runtime.dbPath);
    // 错误通道迁移二期后 projects.create 走 Result，解包取实体。
    const created = await runtime.projects.create("Desktop test");
    if (!created.ok) throw created.error;
    const project = created.value;
    assert.ok(project.id);
    assert.equal(project.name, "Desktop test");
    await DesktopRuntimeSingleton.resetForTest();
  });

  it("round-trips secretStore set/get via platform SKSP", async () => {
    const runtimeR = await DesktopRuntimeFactory.create();
    if (!runtimeR.ok) throw runtimeR.error;
    const runtime = runtimeR.value;
    const ref = "provider/desktop-test/apiKey";
    const value = "sk-desktop-round-trip";
    await runtime.secretStore.set(ref, value);
    assert.equal(await runtime.secretStore.get(ref), value);
    await DesktopRuntimeSingleton.resetForTest();
  });
});
