import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm, vfsListFilePaths } from "./helpers.js";

describe("template pull CLI e2e", () => {
  it("T3 session pull restores template vfs and clears snapshots", async () => {
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
        "session",
        "vfs",
        "snapshot",
        "list",
        "--file",
        "/base.md",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
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
      const snaps = runNm([
        "session",
        "vfs",
        "snapshot",
        "list",
        "--file",
        "/base.md",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(snaps.stdout.trim(), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
