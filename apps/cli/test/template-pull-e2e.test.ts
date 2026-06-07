import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureMessageCheckpoint,
  countSessionCheckpointPointers,
  runNm,
  vfsListFilePaths,
} from "./helpers.js";

describe("template pull CLI e2e", () => {
  it("T3 session pull restores template vfs and clears checkpoints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-tpl-"));
    const dbPath = join(dir, "novel.db");
    try {
      const create = runNm(["project", "create", "--name", "P", "--db", dbPath]);
      const projectId = create.stdout.trim();
      runNm(
        [
          "project",
          "vfs",
          "write",
          "/base.md",
          "--project",
          projectId,
          "--db",
          dbPath,
        ],
        { input: "base" },
      );
      const sess = runNm([
        "session",
        "create",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      const sessionId = sess.stdout.trim();
      runNm(
        [
          "session",
          "vfs",
          "write",
          "/extra.md",
          "--project",
          projectId,
          "--session",
          sessionId,
          "--db",
          dbPath,
        ],
        { input: "extra" },
      );
      runNm(
        [
          "session",
          "vfs",
          "write",
          "/base.md",
          "--project",
          projectId,
          "--session",
          sessionId,
          "--db",
          dbPath,
        ],
        { input: "changed" },
      );
      runNm([
        "message",
        "append",
        "--session",
        sessionId,
        "--role",
        "user",
        "--content",
        "hi",
        "--db",
        dbPath,
      ]);
      const assistant = runNm([
        "message",
        "append",
        "--session",
        sessionId,
        "--role",
        "assistant",
        "--content",
        "wrote",
        "--db",
        dbPath,
      ]);
      const assistantId = assistant.stdout.trim();
      await captureMessageCheckpoint(
        dbPath,
        sessionId,
        projectId,
        assistantId,
      );
      assert.ok(
        (await countSessionCheckpointPointers(dbPath, sessionId)) > 0,
        "expected checkpoint pointers before template pull",
      );
      runNm([
        "session",
        "template",
        "pull",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      const list = runNm([
        "session",
        "vfs",
        "list",
        "/",
        "-r",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      const paths = vfsListFilePaths(list.stdout).sort();
      assert.deepEqual(paths, ["/base.md"]);
      const read = runNm([
        "session",
        "vfs",
        "read",
        "/base.md",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(read.stdout, "base");
      assert.equal(
        await countSessionCheckpointPointers(dbPath, sessionId),
        0,
        "template pull should clear message checkpoints",
      );
      const messages = runNm([
        "message",
        "list",
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(messages.status, 0, messages.stderr);
      assert.equal(
        messages.stdout.trim().split("\n").filter(Boolean).length,
        2,
        "template pull should keep chat messages",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
