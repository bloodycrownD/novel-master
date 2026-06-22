import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetDesktopRuntimeForTest } from "../src/main/runtime/desktop-runtime-singleton.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import { registerPlatformSkspDriver } from "../src/main/runtime/register-platform-drivers.js";
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
    const name = registerPlatformSkspDriver();
    if (process.platform === "darwin") {
      assert.equal(name, "macos");
    } else {
      assert.equal(name, "windows");
    }
  });

  it("bootstraps SQLite and supports project.create smoke", async () => {
    const runtime = await createDesktopNovelMasterRuntime();
    assert.ok(runtime.dbPath);
    const project = await runtime.projects.create("Desktop test");
    assert.ok(project.id);
    assert.equal(project.name, "Desktop test");
    await resetDesktopRuntimeForTest();
  });

  it("round-trips secretStore set/get via platform SKSP", async () => {
    const runtime = await createDesktopNovelMasterRuntime();
    const ref = "provider/desktop-test/apiKey";
    const value = "sk-desktop-round-trip";
    await runtime.secretStore.set(ref, value);
    assert.equal(await runtime.secretStore.get(ref), value);
    await resetDesktopRuntimeForTest();
  });
});
