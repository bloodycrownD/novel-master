import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Projects } from "../src/main/ipc/handlers/projects.js";
import { Scope } from "../src/main/ipc/handlers/scope.js";
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
    const result = await Scope.get();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.projectId, undefined);
      assert.equal(result.data.sessionId, undefined);
    }
  });

  it("projects/list and scope/setProject round-trip", async () => {
    const created = await Projects.create({ name: "IPC smoke" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const listed = await Projects.list();
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(listed.data.length, 1);
      assert.equal(listed.data[0]!.name, "IPC smoke");
    }

    const scoped = await Scope.setProject({ projectId: created.data.id });
    assert.equal(scoped.ok, true);
    if (scoped.ok) {
      assert.equal(scoped.data.projectId, created.data.id);
    }

    const loaded = await Scope.get();
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.data.projectId, created.data.id);
    }
  });
});
