import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

describe("worktree CLI e2e", () => {
  it("T1 project pull aligns worktree list with global", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-wt-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(
        ["vfs", "write", "/template/t.md", "--db", dbPath],
        { input: "t" },
      );
      runNm([
        "vfs",
        "worktree",
        "file",
        "/template/t.md",
        "--mode",
        "hide",
        "--db",
        dbPath,
      ]);
      const create = runNm(["project", "create", "--name", "P", "--db", dbPath]);
      const projectId = create.stdout.trim();
      runNm([
        "project",
        "template",
        "pull",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      const list = runNm([
        "project",
        "worktree",
        "list",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /隐藏/);
      assert.match(list.stdout, /\/template\/t\.md/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 session create inherits mapped worktree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-wt-"));
    const dbPath = join(dir, "novel.db");
    try {
      const create = runNm(["project", "create", "--name", "P", "--db", dbPath]);
      const projectId = create.stdout.trim();
      runNm(
        [
          "project",
          "vfs",
          "write",
          "/template/s.md",
          "--project",
          projectId,
          "--db",
          dbPath,
        ],
        { input: "s" },
      );
      runNm([
        "project",
        "worktree",
        "file",
        "/template/s.md",
        "--mode",
        "show",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      const sess = runNm([
        "session",
        "create",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      const sessionId = sess.stdout.trim();
      const list = runNm([
        "session",
        "worktree",
        "list",
        "--project",
        projectId,
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /\t\/s\.md\t/);
      assert.match(list.stdout, /展示/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T4 hide removes file from display", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-wt-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(
        ["vfs", "write", "/template/h.md", "--db", dbPath],
        { input: "h" },
      );
      runNm([
        "vfs",
        "worktree",
        "file",
        "/template/h.md",
        "--mode",
        "hide",
        "--db",
        dbPath,
      ]);
      const display = runNm(["vfs", "worktree", "display", "--db", dbPath]);
      assert.equal(display.status, 0, display.stderr);
      assert.equal(display.stdout.trim(), "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T5 display includes file path and line numbers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-wt-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(
        ["vfs", "write", "/template/d.md", "--db", dbPath],
        { input: "line1\nline2" },
      );
      runNm([
        "vfs",
        "worktree",
        "file",
        "/template/d.md",
        "--mode",
        "show",
        "--db",
        dbPath,
      ]);
      const display = runNm(["vfs", "worktree", "display", "--db", dbPath]);
      assert.equal(display.status, 0, display.stderr);
      assert.match(display.stdout, /<file path="/);
      assert.match(display.stdout, /1\|line1/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
