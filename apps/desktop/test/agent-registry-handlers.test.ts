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

describe("agent-registry mode 透传（agent-config-tabs T-D1/T-D2）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-agent-registry-mode-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-D1：list valid 行带出 mode 三档各一；mode 缺省 valid 行无 mode 字段；invalid 行无 mode", async () => {
    // createBlank 的 agentId 为 `agent-<Date.now()>`，间隔数毫秒防同毫秒撞 id。
    const primary = await handleAgentRegistryCreateBlank({ mode: "primary" });
    assert.equal(primary.ok, true);
    await new Promise((r) => setTimeout(r, 5));
    const subagent = await handleAgentRegistryCreateBlank({ mode: "subagent" });
    assert.equal(subagent.ok, true);
    await new Promise((r) => setTimeout(r, 5));
    const all = await handleAgentRegistryCreateBlank({ mode: "all" });
    assert.equal(all.ok, true);
    await new Promise((r) => setTimeout(r, 5));
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (!primary.ok || !subagent.ok || !all.ok || !blank.ok) {
      return;
    }

    // invalid 行（removed_feature）直接落库，读不出定义 → 天然无 mode。
    const rt = await createDesktopNovelMasterRuntime();
    const now = Date.now();
    await rt.conn.execute(
      `INSERT INTO agent_definition (
        agent_id, prompts_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?)`,
      [
        "broken-mode-agent",
        JSON.stringify({
          schemaVersion: 1,
          name: "broken-mode",
          prompts: { blocks: {} },
        }),
        now,
        now,
      ],
    );
    await resetDesktopRuntimeForTest();

    const listed = await handleAgentRegistryList();
    assert.equal(listed.ok, true);
    if (!listed.ok) {
      return;
    }

    const primaryRow = listed.data.find(
      (r) => r.agentId === primary.data.agentId,
    );
    assert.ok(primaryRow);
    assert.equal(primaryRow!.mode, "primary");

    const subagentRow = listed.data.find(
      (r) => r.agentId === subagent.data.agentId,
    );
    assert.ok(subagentRow);
    assert.equal(subagentRow!.mode, "subagent");

    const allRow = listed.data.find((r) => r.agentId === all.data.agentId);
    assert.ok(allRow);
    assert.equal(allRow!.mode, "all");

    // mode 缺省的 valid 行：响应体不含 mode 字段（未填写 = 双边显示语义）。
    const blankRow = listed.data.find(
      (r) => r.agentId === blank.data.agentId,
    );
    assert.ok(blankRow);
    assert.equal(blankRow!.mode, undefined);
    assert.equal("mode" in blankRow!, false);

    const brokenRow = listed.data.find(
      (r) => r.agentId === "broken-mode-agent",
    );
    assert.ok(brokenRow);
    assert.ok(brokenRow!.invalid);
    assert.equal("mode" in brokenRow!, false);
  });

  it("T-D2：createBlank 带 mode 落库 wire 含 mode；不传 payload 落库无 mode（现行为回归）", async () => {
    const sub = await handleAgentRegistryCreateBlank({ mode: "subagent" });
    assert.equal(sub.ok, true);
    if (!sub.ok) {
      return;
    }
    const rt = await createDesktopNovelMasterRuntime();
    const subRows = await rt.conn.query<{ prompts_json: string }>(
      `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
      [sub.data.agentId],
    );
    await resetDesktopRuntimeForTest();
    assert.equal(subRows.length, 1);
    const subWire = JSON.parse(
      String(subRows[0]!.prompts_json),
    ) as Record<string, unknown>;
    assert.equal(subWire.mode, "subagent");

    await new Promise((r) => setTimeout(r, 5));
    const plain = await handleAgentRegistryCreateBlank();
    assert.equal(plain.ok, true);
    if (!plain.ok) {
      return;
    }
    const rt2 = await createDesktopNovelMasterRuntime();
    const plainRows = await rt2.conn.query<{ prompts_json: string }>(
      `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
      [plain.data.agentId],
    );
    await resetDesktopRuntimeForTest();
    assert.equal(plainRows.length, 1);
    const plainWire = JSON.parse(
      String(plainRows[0]!.prompts_json),
    ) as Record<string, unknown>;
    assert.equal("mode" in plainWire, false);
  });
});
