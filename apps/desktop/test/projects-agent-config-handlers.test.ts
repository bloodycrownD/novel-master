import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  handleProjectsCreate,
  handleProjectsGetAgentConfig,
  handleProjectsUpdateAgentConfig,
} from "../src/main/ipc/handlers/projects.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("projects agent-config IPC handlers", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-project-agent-config-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("getAgentConfig 默认 follow", async () => {
    const created = await handleProjectsCreate({ name: "Agent 配置测试" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const loaded = await handleProjectsGetAgentConfig({
      projectId: created.data.id,
    });
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.data.mode, "follow");
      assert.equal(loaded.data.definition, undefined);
    }
  });

  it("updateAgentConfig custom round-trip（assessed definition health）", async () => {
    const created = await handleProjectsCreate({ name: "Custom Agent" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const definition = {
      name: "项目专属",
      prompts: { persist: [], dynamic: [] },
    };

    const saved = await handleProjectsUpdateAgentConfig({
      projectId: created.data.id,
      patch: { mode: "custom", definition },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) {
      return;
    }
    assert.equal(saved.data.mode, "custom");
    assert.equal(saved.data.definition?.status, "valid");
    if (saved.data.definition?.status === "valid") {
      assert.equal(saved.data.definition.value.name, "项目专属");
    }

    const loaded = await handleProjectsGetAgentConfig({
      projectId: created.data.id,
    });
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.data.mode, "custom");
      assert.equal(loaded.data.definition?.status, "valid");
      if (loaded.data.definition?.status === "valid") {
        assert.equal(loaded.data.definition.value.name, "项目专属");
      }
    }
  });

  it("切回 follow 保留 definition 草稿（assessed）", async () => {
    const created = await handleProjectsCreate({ name: "Follow Draft" });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const definition = {
      name: "草稿",
      prompts: { persist: [], dynamic: [] },
    };

    await handleProjectsUpdateAgentConfig({
      projectId: created.data.id,
      patch: { mode: "custom", definition },
    });

    const follow = await handleProjectsUpdateAgentConfig({
      projectId: created.data.id,
      patch: { mode: "follow" },
    });
    assert.equal(follow.ok, true);
    if (follow.ok) {
      assert.equal(follow.data.mode, "follow");
      assert.equal(follow.data.definition?.status, "valid");
      if (follow.data.definition?.status === "valid") {
        assert.equal(follow.data.definition.value.name, "草稿");
      }
    }
  });
});
