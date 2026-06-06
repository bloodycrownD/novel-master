import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import { registerPlatformSkspDriver } from "../src/main/runtime/register-platform-drivers.js";

describe("createDesktopNovelMasterRuntime", () => {
  let tempDir: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-desktop-runtime-"));
    process.env.NOVEL_MASTER_DB = join(tempDir, "novel.db");
  });

  after(async () => {
    await closeDesktopConnection();
    delete process.env.NOVEL_MASTER_DB;
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(false);
    } else {
      setDpapiTestPassthrough(false);
    }
    await rm(tempDir, { recursive: true, force: true });
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
    await closeDesktopConnection();
  });

  it("round-trips secretStore set/get via platform SKSP", async () => {
    const runtime = await createDesktopNovelMasterRuntime();
    const ref = "provider/desktop-test/apiKey";
    const value = "sk-desktop-round-trip";
    await runtime.secretStore.set(ref, value);
    assert.equal(await runtime.secretStore.get(ref), value);
    await closeDesktopConnection();
  });
});
