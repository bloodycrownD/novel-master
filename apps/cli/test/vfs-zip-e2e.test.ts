import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { unzipSync } from "fflate";
import { vfsListFilePaths } from "./helpers.js";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

function runCli(
  args: string[],
  options?: { input?: string },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      input: options?.input,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("vfs zip CLI e2e", () => {
  it("global export-zip and import-zip round trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "global.zip");
    try {
      const w = runCli(
        ["vfs", "--db", dbPath, "write", "/seed.md"],
        { input: "seed" },
      );
      assert.equal(w.status, 0, w.stderr);

      const exp = runCli(["vfs", "--db", dbPath, "export-zip", "--out", zipPath]);
      assert.equal(exp.status, 0, exp.stderr);

      const raw = await readFile(zipPath);
      const zipNames = Object.keys(unzipSync(new Uint8Array(raw)));
      assert.ok(zipNames.includes("seed.md"));
      assert.ok(!zipNames.some((n) => n.startsWith("template/")));

      const w2 = runCli(
        ["vfs", "--db", dbPath, "write", "/extra.md"],
        { input: "gone" },
      );
      assert.equal(w2.status, 0, w2.stderr);

      const imp = runCli([
        "vfs",
        "--db",
        dbPath,
        "import-zip",
        "--file",
        zipPath,
        "--yes",
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const list = runCli(["vfs", "--db", dbPath, "list", "/", "-r"]);
      assert.equal(list.status, 0, list.stderr);
      const paths = vfsListFilePaths(list.stdout);
      assert.deepEqual(paths, ["/seed.md"]);

      const read = runCli(["vfs", "--db", dbPath, "read", "/seed.md"]);
      assert.equal(read.stdout, "seed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("import-zip without --yes fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "t.zip");
    try {
      const w = runCli(
        ["vfs", "--db", dbPath, "write", "/a.md"],
        { input: "a" },
      );
      assert.equal(w.status, 0, w.stderr);
      const exp = runCli(["vfs", "--db", dbPath, "export-zip", "--out", zipPath]);
      assert.equal(exp.status, 0, exp.stderr);
      const imp = runCli(["vfs", "--db", dbPath, "import-zip", "--file", zipPath]);
      assert.notEqual(imp.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session vfs export-zip matches written content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "session.zip");
    try {
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const session = runCli([
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
      const sessionId = session.stdout.trim();

      const write = runCli(
        ["session", "vfs", "write", "/note.md", "--db", dbPath],
        { input: "note-body" },
      );
      assert.equal(write.status, 0, write.stderr);

      const exp = runCli([
        "session",
        "vfs",
        "export-zip",
        "--out",
        zipPath,
        "--db",
        dbPath,
      ]);
      assert.equal(exp.status, 0, exp.stderr);

      const raw = await readFile(zipPath);
      const entries = unzipSync(new Uint8Array(raw));
      assert.equal(new TextDecoder().decode(entries["note.md"]!), "note-body");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("project vfs export-zip and import-zip round trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "project.zip");
    try {
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const seed = runCli(
        [
          "project",
          "vfs",
          "write",
          "/seed.md",
          "--project",
          projectId,
          "--db",
          dbPath,
        ],
        { input: "project-seed" },
      );
      assert.equal(seed.status, 0, seed.stderr);

      const exp = runCli([
        "project",
        "vfs",
        "export-zip",
        "--out",
        zipPath,
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(exp.status, 0, exp.stderr);

      const extra = runCli(
        [
          "project",
          "vfs",
          "write",
          "/stale.md",
          "--project",
          projectId,
          "--db",
          dbPath,
        ],
        { input: "stale" },
      );
      assert.equal(extra.status, 0, extra.stderr);

      const imp = runCli([
        "project",
        "vfs",
        "import-zip",
        "--file",
        zipPath,
        "--yes",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const list = runCli([
        "project",
        "vfs",
        "list",
        "/",
        "-r",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(list.status, 0, list.stderr);
      assert.deepEqual(vfsListFilePaths(list.stdout), ["/seed.md"]);

      const read = runCli([
        "project",
        "vfs",
        "read",
        "/seed.md",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout, "project-seed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session vfs import-zip --yes matches export list and read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "session-import.zip");
    try {
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const session = runCli([
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

      const writeOne = runCli(
        ["session", "vfs", "write", "/one.md", "--db", dbPath],
        { input: "one" },
      );
      assert.equal(writeOne.status, 0, writeOne.stderr);
      const writeTwo = runCli(
        ["session", "vfs", "write", "/nested/two.md", "--db", dbPath],
        { input: "two" },
      );
      assert.equal(writeTwo.status, 0, writeTwo.stderr);

      const exp = runCli([
        "session",
        "vfs",
        "export-zip",
        "--out",
        zipPath,
        "--db",
        dbPath,
      ]);
      assert.equal(exp.status, 0, exp.stderr);

      const sessionB = runCli([
        "session",
        "create",
        "--title",
        "other",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(sessionB.status, 0, sessionB.stderr);

      runCli(["session", "use", "--session", sessionB.stdout.trim(), "--db", dbPath]);

      const imp = runCli([
        "session",
        "vfs",
        "import-zip",
        "--file",
        zipPath,
        "--yes",
        "--db",
        dbPath,
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const list = runCli(["session", "vfs", "list", "/", "-r", "--db", dbPath]);
      assert.equal(list.status, 0, list.stderr);
      const paths = vfsListFilePaths(list.stdout).sort();
      assert.deepEqual(paths, ["/nested/two.md", "/one.md"]);

      const readOne = runCli([
        "session",
        "vfs",
        "read",
        "/one.md",
        "--db",
        dbPath,
      ]);
      assert.equal(readOne.stdout, "one");
      const readTwo = runCli([
        "session",
        "vfs",
        "read",
        "/nested/two.md",
        "--db",
        dbPath,
      ]);
      assert.equal(readTwo.stdout, "two");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session ZIP imports into project template vfs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-zip-"));
    const dbPath = join(dir, "novel.db");
    const zipPath = join(dir, "cross.zip");
    try {
      const project = runCli([
        "project",
        "create",
        "--name",
        "P",
        "--db",
        dbPath,
      ]);
      assert.equal(project.status, 0, project.stderr);
      const projectId = project.stdout.trim();

      const session = runCli([
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

      const write = runCli(
        [
          "session",
          "vfs",
          "write",
          "/ddd/love_message.txt",
          "--db",
          dbPath,
        ],
        { input: "你好" },
      );
      assert.equal(write.status, 0, write.stderr);

      const exp = runCli([
        "session",
        "vfs",
        "export-zip",
        "--out",
        zipPath,
        "--db",
        dbPath,
      ]);
      assert.equal(exp.status, 0, exp.stderr);

      const imp = runCli([
        "project",
        "vfs",
        "import-zip",
        "--file",
        zipPath,
        "--yes",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(imp.status, 0, imp.stderr);

      const read = runCli([
        "project",
        "vfs",
        "read",
        "/ddd/love_message.txt",
        "--project",
        projectId,
        "--db",
        dbPath,
      ]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout, "你好");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
