import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dbDir, readCliConfig, runNm } from "./helpers.js";

describe("CLI config context e2e", () => {
  it("T1: project create writes currentProjectId to config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      const create = runNm(["project", "create", "--name", "A", "--db", dbPath]);
      assert.equal(create.status, 0, create.stderr);
      const projectId = create.stdout.trim();
      const config = await readCliConfig(dbPath);
      assert.equal(config.currentProjectId, projectId);
      assert.equal(config.currentSessionId, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2: session create without --project uses config project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      const project = runNm(["project", "create", "--name", "A", "--db", dbPath]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const session = runNm([
        "session",
        "create",
        "--title",
        "main",
        "--db",
        dbPath,
      ]);
      assert.equal(session.status, 0, session.stderr);
      const sessionId = session.stdout.trim();

      const config = await readCliConfig(dbPath);
      assert.equal(config.currentProjectId, projectId);
      assert.equal(config.currentSessionId, sessionId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T3: message append and list without --session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["project", "create", "--name", "A", "--db", dbPath]);
      runNm(["session", "create", "--db", dbPath]);

      const append = runNm([
        "message",
        "append",
        "--role",
        "user",
        "--content",
        "hi",
        "--db",
        dbPath,
      ]);
      assert.equal(append.status, 0, append.stderr);

      const list = runNm(["message", "list", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /hi/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T4: message list --session overrides config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      const project = runNm(["project", "create", "--name", "A", "--db", dbPath]);
      const projectId = project.stdout.trim();
      const s1 = runNm(["session", "create", "--db", dbPath]).stdout.trim();
      runNm([
        "message",
        "append",
        "--role",
        "user",
        "--content",
        "only-s1",
        "--db",
        dbPath,
      ]);
      const s2 = runNm([
        "session",
        "create",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]).stdout.trim();
      runNm([
        "message",
        "append",
        "--session",
        s2,
        "--role",
        "user",
        "--content",
        "only-s2",
        "--db",
        dbPath,
      ]);

      const list = runNm([
        "message",
        "list",
        "--session",
        s2,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.match(list.stdout, /only-s2/);
      assert.doesNotMatch(list.stdout, /only-s1/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T5: project vfs write/read without --project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      const project = runNm(["project", "create", "--name", "A", "--db", dbPath]);
      const projectId = project.stdout.trim();

      const write = runNm([
        "project",
        "vfs",
        "write",
        "/template/t.md",
        "--text",
        "x",
        "--db",
        dbPath,
      ]);
      assert.equal(write.status, 0, write.stderr);

      const read = runNm([
        "project",
        "vfs",
        "read",
        "/template/t.md",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout.trim(), "x");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T6: project use clears currentSessionId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      const p1 = runNm(["project", "create", "--name", "P1", "--db", dbPath]).stdout
        .trim();
      runNm(["session", "create", "--db", dbPath]);
      let config = await readCliConfig(dbPath);
      assert.ok(config.currentSessionId);

      const p2 = runNm([
        "project",
        "copy",
        "--project",
        p1,
        "--db",
        dbPath,
      ]).stdout.trim();

      const use = runNm(["project", "use", "--project", p2, "--db", dbPath]);
      assert.equal(use.status, 0, use.stderr);

      config = await readCliConfig(dbPath);
      assert.equal(config.currentProjectId, p2);
      assert.equal(config.currentSessionId, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T7: config path follows --db directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const subDir = join(dir, "sub");
    const dbPath = join(subDir, "db.sqlite");
    try {
      runNm(["project", "create", "--name", "A", "--db", dbPath]);
      const config = await readCliConfig(dbPath);
      assert.ok(config.currentProjectId);
      assert.equal(dbDir(dbPath), subDir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T8: session delete clears currentSessionId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["project", "create", "--name", "A", "--db", dbPath]);
      const sessionId = runNm(["session", "create", "--db", dbPath]).stdout.trim();

      const del = runNm([
        "session",
        "delete",
        "--session",
        sessionId,
        "--db",
        dbPath,
      ]);
      assert.equal(del.status, 0, del.stderr);

      const config = await readCliConfig(dbPath);
      assert.equal(config.currentSessionId, undefined);
      assert.ok(config.currentProjectId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T9: message list without config session fails with use hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-ctx-"));
    const dbPath = join(dir, "novel.db");
    try {
      runNm(["project", "create", "--name", "A", "--db", dbPath]);
      const config = await readCliConfig(dbPath);
      assert.ok(config.currentProjectId);
      assert.equal(config.currentSessionId, undefined);

      const list = runNm(["message", "list", "--db", dbPath]);
      assert.notEqual(list.status, 0);
      assert.match(list.stderr, /session use/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
