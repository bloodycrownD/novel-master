import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_ENTRY = join(CLI_ROOT, "src", "index.ts");

function runCli(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; input?: string },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, ...args],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...options?.env },
      input: options?.input,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("vfs CLI e2e", () => {
  it("write + read round trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      const write = runCli(["vfs", "--db", dbPath, "write", "/template/hello.txt"], {
        input: "hello cli",
      });
      assert.equal(write.status, 0, write.stderr);

      const read = runCli(["vfs", "--db", dbPath, "read", "/template/hello.txt"]);
      assert.equal(read.status, 0, read.stderr);
      assert.equal(read.stdout, "hello cli");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("list recursive with depth", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/a"], { input: "a" });
      runCli(["vfs", "--db", dbPath, "write", "/template/a/b"], { input: "b" });
      runCli(["vfs", "--db", dbPath, "write", "/template/a/b/c"], { input: "c" });

      const list = runCli([
        "vfs",
        "--db",
        dbPath,
        "list",
        "/template/a",
        "-r",
        "--depth",
        "2",
      ]);
      assert.equal(list.status, 0, list.stderr);
      const lines = list.stdout.trim().split("\n").filter(Boolean);
      assert.deepEqual(lines.sort(), ["/template/a/b", "/template/a/b/c"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replace updates content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/r.txt"], { input: "a X b X" });
      const replaced = runCli([
        "vfs",
        "--db",
        dbPath,
        "replace",
        "/template/r.txt",
        "X",
        "Y",
        "--all",
      ]);
      assert.equal(replaced.status, 0, replaced.stderr);

      const read = runCli(["vfs", "--db", dbPath, "read", "/template/r.txt"]);
      assert.equal(read.stdout, "a Y b Y");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("glob and grep", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/docs/a.md"], {
        input: "# Title",
      });
      runCli(["vfs", "--db", dbPath, "write", "/template/docs/b.txt"], {
        input: "plain",
      });

      const glob = runCli(["vfs", "--db", dbPath, "glob", "**/*.md"]);
      assert.equal(glob.status, 0, glob.stderr);
      assert.match(glob.stdout, /\/template\/docs\/a\.md/);

      const grep = runCli(["vfs", "--db", dbPath, "grep", "Title"]);
      assert.equal(grep.status, 0, grep.stderr);
      assert.match(grep.stdout, /\/template\/docs\/a\.md:1:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("delete recursive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/tree"], { input: "root" });
      runCli(["vfs", "--db", dbPath, "write", "/template/tree/leaf"], {
        input: "leaf",
      });
      const del = runCli([
        "vfs",
        "--db",
        dbPath,
        "delete",
        "/template/tree",
        "-r",
      ]);
      assert.equal(del.status, 0, del.stderr);

      const read = runCli(["vfs", "--db", dbPath, "read", "/template/tree/leaf"]);
      assert.notEqual(read.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("write with wrong version exits non-zero", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/v.txt"], { input: "one" });
      runCli(["vfs", "--db", dbPath, "write", "/template/v.txt", "--version", "1"], {
        input: "two",
      });
      const bad = runCli(
        ["vfs", "--db", dbPath, "write", "/template/v.txt", "--version", "1"],
        { input: "three" },
      );
      assert.equal(bad.status, 2);
      assert.match(bad.stderr, /conflict|Version/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("write from --file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    const payload = join(dir, "payload.txt");
    try {
      await writeFile(payload, "from file", "utf8");
      const write = runCli([
        "vfs",
        "--db",
        dbPath,
        "write",
        "/template/file.txt",
        "--file",
        payload,
      ]);
      assert.equal(write.status, 0, write.stderr);
      const read = runCli(["vfs", "--db", dbPath, "read", "/template/file.txt"]);
      assert.equal(read.stdout, "from file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("write with --text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      const write = runCli(
        ["vfs", "--db", dbPath, "write", "/template/text.txt"],
        { input: "inline body" },
      );
      assert.equal(write.status, 0, write.stderr);
      const read = runCli(["vfs", "--db", dbPath, "read", "/template/text.txt"]);
      assert.equal(read.stdout, "inline body");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replace with --old and --new flags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-vfs-"));
    const dbPath = join(dir, "novel.db");
    try {
      runCli(["vfs", "--db", dbPath, "write", "/template/r2.txt"], {
        input: "hello world",
      });
      const replaced = runCli([
        "vfs",
        "--db",
        dbPath,
        "replace",
        "/template/r2.txt",
        "--old",
        "world",
        "--new",
        "there",
      ]);
      assert.equal(replaced.status, 0, replaced.stderr);

      const read = runCli(["vfs", "--db", dbPath, "read", "/template/r2.txt"]);
      assert.equal(read.stdout, "hello there");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves greet fallback", () => {
    const greet = runCli(["Ada"]);
    assert.equal(greet.status, 0);
    assert.match(greet.stdout, /Hello, Ada/);
  });
});
