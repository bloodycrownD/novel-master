import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import { handleEventsGetConfig } from "../src/main/ipc/handlers/events-config-handlers.js";

describe("events IPC handlers", () => {
  let tempDir: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-events-handlers-"));
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

  it("T-IPC2：invalid wire 时 config 为 null 且 wire 原样返回", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    const brokenWire = { schemaVersion: 1, events: {} };
    await rt.conn.execute(
      `INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)`,
      ["nm-events", "config", JSON.stringify(brokenWire)],
    );
    await closeDesktopConnection();

    const result = await handleEventsGetConfig();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.data.config, null);
    assert.deepEqual(result.data.wire, brokenWire);
  });
});
