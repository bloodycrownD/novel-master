import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleProjectsCreate, handleProjectsList } from "../src/main/ipc/handlers/projects.js";
import { handleScopeGet, handleScopeSetProject } from "../src/main/ipc/handlers/scope.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("desktop ipc handlers", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-ipc-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
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
