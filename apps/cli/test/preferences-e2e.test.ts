import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

describe("preferences CLI e2e", () => {
  it("C1: session-fs.versionCheck 已退役：set/get/reset 均拒绝", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      for (const args of [
        ["set", "session-fs.versionCheck", "false"],
        ["get", "session-fs.versionCheck"],
        ["reset", "session-fs.versionCheck"],
      ] as const) {
        const res = runNm([
          "preferences",
          ...args,
          "--db",
          dbPath,
        ]);
        assert.notEqual(res.status, 0, args.join(" "));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C2: nm config and nm kkv are rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      const config = runNm(["config", "list", "--db", dbPath]);
      assert.notEqual(config.status, 0);

      const kkv = runNm([
        "kkv",
        "list",
        "--module",
        "app",
        "--db",
        dbPath,
      ]);
      assert.notEqual(kkv.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preferences reset restores chat.llmStream default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm([
        "preferences",
        "set",
        "chat.llmStream",
        "false",
        "--db",
        dbPath,
      ]);
      runNm([
        "preferences",
        "reset",
        "chat.llmStream",
        "--db",
        dbPath,
      ]);
      const get = runNm([
        "preferences",
        "get",
        "chat.llmStream",
        "--db",
        dbPath,
      ]);
      assert.equal(get.status, 0, get.stderr);
      assert.equal(get.stdout.trim(), "true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T8: preferences set tokenCounter.mode is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-tc-"));
    const dbPath = join(dir, "novel.db");
    try {
      const set = runNm([
        "preferences",
        "set",
        "tokenCounter.mode",
        "heuristic",
        "--db",
        dbPath,
      ]);
      assert.notEqual(set.status, 0);
      assert.match(set.stderr, /Usage: nm preferences set/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("C5: session vfs write 对已存在文件缺省免版本校验（last-write-wins）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-"));
    const dbPath = join(dir, "novel.db");
    /** 新库首次命令的 stdout 可能混入 [nm-boot] migration 日志，取末行作 id。 */
    const lastLine = (out: string): string =>
      out.trim().split("\n").filter(Boolean).pop() ?? "";
    try {
      const project = runNm([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = lastLine(project.stdout);

      const session = runNm([
        "session",
        "create",
        "--title",
        "main",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(session.status, 0, session.stderr);

      const first = runNm(
        ["session", "vfs", "write", "/notes/a.md", "--db", dbPath],
        { input: "v1" },
      );
      assert.equal(first.status, 0, first.stderr);

      // 不再依赖任何偏好：覆盖已存在文件直接成功
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

  it("T6: v2 chat.llmStream set/get/reset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-v2-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm([
        "preferences",
        "set",
        "chat.llmStream",
        "false",
        "--db",
        dbPath,
      ]);
      const get = runNm([
        "preferences",
        "get",
        "chat.llmStream",
        "--db",
        dbPath,
      ]);
      assert.equal(get.status, 0, get.stderr);
      assert.equal(get.stdout.trim(), "false");

      runNm(["preferences", "reset", "chat.llmStream", "--db", dbPath]);
      const afterReset = runNm([
        "preferences",
        "get",
        "chat.llmStream",
        "--db",
        dbPath,
      ]);
      assert.equal(afterReset.stdout.trim(), "true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("vfs.userVfsUnifiedToolTurn set/get/reset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-vfs-flag-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm([
        "preferences",
        "set",
        "vfs.userVfsUnifiedToolTurn",
        "false",
        "--db",
        dbPath,
      ]);
      const get = runNm([
        "preferences",
        "get",
        "vfs.userVfsUnifiedToolTurn",
        "--db",
        dbPath,
      ]);
      assert.equal(get.status, 0, get.stderr);
      assert.equal(get.stdout.trim(), "false");

      runNm(["preferences", "reset", "vfs.userVfsUnifiedToolTurn", "--db", dbPath]);
      const afterReset = runNm([
        "preferences",
        "get",
        "vfs.userVfsUnifiedToolTurn",
        "--db",
        dbPath,
      ]);
      assert.equal(afterReset.stdout.trim(), "true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T6: rejects retired preference keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-pref-v2-"));
    const dbPath = join(dir, "novel.db");
    try {
      for (const key of [
        "chat.showFullToolParams",
        "session-fs.checkpointRetention",
      ]) {
        const rejected = runNm(["preferences", "set", key, "true", "--db", dbPath]);
        assert.notEqual(rejected.status, 0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
