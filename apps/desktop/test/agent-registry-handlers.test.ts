import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetDesktopRuntimeForTest } from "../src/main/runtime/desktop-runtime-singleton.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryGet,
  handleAgentRegistryList,
} from "../src/main/ipc/handlers/agent-registry.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("agent-registry IPC handlers", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-agent-registry-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("list 对单条失效 wire 返回 invalid 且保留其余行", async () => {
    const created = await handleAgentRegistryCreateBlank();
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const rt = await createDesktopNovelMasterRuntime();
    const now = Date.now();
    const brokenWire = {
      schemaVersion: 1,
      name: "broken",
      prompts: { blocks: {} },
    };
    await rt.conn.execute(
      `INSERT INTO agent_definition (
        agent_id, prompts_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?)`,
      ["broken-agent", JSON.stringify(brokenWire), now, now],
    );
    await resetDesktopRuntimeForTest();

    const listed = await handleAgentRegistryList();
    assert.equal(listed.ok, true);
    if (!listed.ok) {
      return;
    }

    const broken = listed.data.find((row) => row.agentId === "broken-agent");
    assert.ok(broken);
    assert.equal(broken!.name, "broken");
    assert.ok(broken!.invalid);
    assert.equal(broken!.invalid!.code, "removed_feature");
    assert.match(broken!.invalid!.message, /prompts\.blocks/);
    assert.equal(broken!.decodeError, broken!.invalid!.message);

    const healthy = listed.data.find((row) => row.agentId === created.data.agentId);
    assert.ok(healthy);
    assert.equal(healthy!.invalid, undefined);
    assert.equal(healthy!.decodeError, undefined);
    assert.equal(listed.data.length, 2);
  });

  it("get 返回 assessed StoredConfigHealthDto（valid）", async () => {
    const created = await handleAgentRegistryCreateBlank();
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }

    const got = await handleAgentRegistryGet({ agentId: created.data.agentId });
    assert.equal(got.ok, true);
    if (!got.ok) {
      return;
    }
    assert.equal(got.data.status, "valid");
    assert.ok(got.data.wire);
    if (got.data.status === "valid") {
      assert.ok(typeof got.data.value.name === "string");
      assert.ok(got.data.value.name.length > 0);
    }
  });

  it("get 对失效 wire 返回 assessed invalid", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    const now = Date.now();
    const brokenWire = {
      schemaVersion: 1,
      name: "broken-get",
      prompts: { blocks: {} },
    };
    await rt.conn.execute(
      `INSERT INTO agent_definition (
        agent_id, prompts_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?)`,
      ["broken-get-agent", JSON.stringify(brokenWire), now, now],
    );
    await resetDesktopRuntimeForTest();

    const got = await handleAgentRegistryGet({ agentId: "broken-get-agent" });
    assert.equal(got.ok, true);
    if (!got.ok) {
      return;
    }
    assert.equal(got.data.status, "invalid");
    assert.deepEqual(got.data.wire, brokenWire);
    if (got.data.status === "invalid") {
      assert.equal(got.data.code, "removed_feature");
    }
  });
});
