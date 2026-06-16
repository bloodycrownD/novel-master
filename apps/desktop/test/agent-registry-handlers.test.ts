import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryList,
} from "../src/main/ipc/handlers/agent-registry.js";

describe("agent-registry IPC handlers", () => {
  let tempDir: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-agent-registry-"));
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
    await closeDesktopConnection();

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
});
