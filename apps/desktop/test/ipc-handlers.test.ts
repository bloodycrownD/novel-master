import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import { handleProjectsCreate, handleProjectsList } from "../src/main/ipc/handlers/projects.js";
import { handleScopeGet, handleScopeSetProject } from "../src/main/ipc/handlers/scope.js";

describe("desktop ipc handlers", () => {
  let tempDir: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-desktop-ipc-"));
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

  it("scope/get returns reconciled empty scope on fresh db", async () => {
    const result = await handleScopeGet();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.projectId, undefined);
      assert.equal(result.data.sessionId, undefined);
    }
  });

  it("projects/list and scope/setProject round-trip", async () => {
    const created = await handleProjectsCreate({ name: "IPC smoke" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const listed = await handleProjectsList();
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(listed.data.length, 1);
      assert.equal(listed.data[0]!.name, "IPC smoke");
    }

    const scoped = await handleScopeSetProject({ projectId: created.data.id });
    assert.equal(scoped.ok, true);
    if (scoped.ok) {
      assert.equal(scoped.data.projectId, created.data.id);
    }

    const loaded = await handleScopeGet();
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.data.projectId, created.data.id);
    }
  });
});
