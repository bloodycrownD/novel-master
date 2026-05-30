import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

describe("preferences CLI e2e", () => {
  it("C1: set/get/list session-fs.versionCheck", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      const set = runNm([
        "preferences",
        "set",
        "session-fs.versionCheck",
        "false",
        "--db",
        dbPath,
      ]);
      assert.equal(set.status, 0, set.stderr);

      const get = runNm([
        "preferences",
        "get",
        "session-fs.versionCheck",
        "--db",
        dbPath,
      ]);
      assert.equal(get.status, 0, get.stderr);
      assert.equal(get.stdout.trim(), "false");

      const list = runNm(["preferences", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /session-fs\.versionCheck\tfalse/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C2: nm config is rejected with usage error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      const result = runNm(["config", "list", "--db", dbPath]);
      assert.notEqual(result.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C5: versionCheck false allows session vfs write without version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["project", "create", "--name", "P", "--db", dbPath]);
      runNm(["session", "create", "--db", dbPath]);

      const first = runNm(
        ["session", "vfs", "write", "/notes/a.md", "--db", dbPath],
        { input: "v1" },
      );
      assert.equal(first.status, 0, first.stderr);

      runNm([
        "preferences",
        "set",
        "session-fs.versionCheck",
        "false",
        "--db",
        dbPath,
      ]);

      const second = runNm(
        ["session", "vfs", "write", "/notes/a.md", "--db", dbPath],
        { input: "v2" },
      );
      assert.equal(second.status, 0, second.stderr);

      const read = runNm([
        "session",
        "vfs",
        "read",
        "/notes/a.md",
        "--db",
        dbPath,
      ]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout, "v2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
