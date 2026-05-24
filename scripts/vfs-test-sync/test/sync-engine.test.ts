import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import type { SyncConfig } from "../src/config.js";
import { pull, push } from "../src/sync-engine.js";
import { openVfsTestConnection } from "./helpers.js";

async function withTempMirror(
  fn: (mirrorRoot: string, config: SyncConfig) => Promise<void>,
): Promise<void> {
  const mirrorRoot = join(
    tmpdir(),
    `vfs-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const config: SyncConfig = {
    mirrorRoot,
    prefix: "/",
    verbose: false,
    debounceMs: 300,
    pollMs: 500,
  };
  try {
    await fn(mirrorRoot, config);
  } finally {
    await rm(mirrorRoot, { recursive: true, force: true });
  }
}

describe("sync-engine", () => {
  it("T1: push writes VFS content to disk", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (_root, config) => {
      await vfs.write("/a.md", "from-vfs");
      await push(vfs, config);
      const disk = await readFile(join(config.mirrorRoot, "a.md"), "utf8");
      assert.equal(disk, "from-vfs");
    });
    await conn.close();
  });

  it("T2: push deletes disk orphans", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await vfs.write("/keep.md", "keep");
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "orphan.md"), "gone", "utf8");
      await push(vfs, config);
      const keep = await readFile(join(root, "keep.md"), "utf8");
      assert.equal(keep, "keep");
      await assert.rejects(() => readFile(join(root, "orphan.md"), "utf8"));
    });
    await conn.close();
  });

  it("T3: pull writes disk files to VFS", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "c.md"), "from-disk", "utf8");
      await pull(vfs, config);
      const read = await vfs.read("/c.md");
      assert.equal(read.content, "from-disk");
    });
    await conn.close();
  });

  it("T4: pull deletes VFS orphans", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await vfs.write("/d.md", "stale");
      await mkdir(root, { recursive: true });
      await pull(vfs, config);
      await assert.rejects(() => vfs.read("/d.md"));
    });
    await conn.close();
  });

  it("T5: push then disk edit then pull round-trips", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await vfs.write("/round.md", "v1");
      await push(vfs, config);
      await writeFile(join(root, "round.md"), "v2-disk", "utf8");
      await pull(vfs, config);
      const read = await vfs.read("/round.md");
      assert.equal(read.content, "v2-disk");
    });
    await conn.close();
  });
});
