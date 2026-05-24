import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import type { SyncConfig } from "../src/config.js";
import { createSyncEngine, pull, push } from "../src/sync-engine.js";
import {
  createDebouncedSyncScheduler,
  runWatch,
  type WatchDriver,
} from "../src/watch.js";
import { openVfsTestConnection } from "./helpers.js";

async function withTempMirror(
  fn: (mirrorRoot: string, config: SyncConfig) => Promise<void>,
): Promise<void> {
  const mirrorRoot = join(
    tmpdir(),
    `vfs-sync-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const config: SyncConfig = {
    mirrorRoot,
    prefix: "/",
    verbose: false,
    debounceMs: 50,
    pollMs: 50,
  };
  try {
    await fn(mirrorRoot, config);
  } finally {
    await rm(mirrorRoot, { recursive: true, force: true });
  }
}

describe("watch scheduler", () => {
  it("runs pull then push when both sides change in one window", async () => {
    const order: string[] = [];
    const engine = {
      pull: async () => {
        order.push("pull");
        return { written: 0, deleted: 0 };
      },
      push: async () => {
        order.push("push");
        return { written: 0, deleted: 0 };
      },
    };
    const scheduler = createDebouncedSyncScheduler(engine, 20);
    scheduler.schedule("disk");
    scheduler.schedule("vfs");
    await scheduler.flush();
    assert.deepEqual(order, ["pull", "push"]);
  });
});

describe("runWatch", () => {
  it("T6: disk change triggers pull after debounce", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await vfs.write("/watch-disk.md", "vfs");
      await push(vfs, config);

      let diskCallback: (() => void) | null = null;
      let pollTick: (() => void | Promise<void>) | null = null;
      const driver: WatchDriver = {
        watchDisk(onChange) {
          diskCallback = onChange;
          return { close() {} };
        },
        startVfsPoll(onTick, _pollMs) {
          pollTick = onTick;
          return { stop() {} };
        },
      };

      const engine = createSyncEngine(vfs, config);
      const watchPromise = runWatch({
        config,
        engine,
        vfs,
        driver,
        once: true,
      });

      await writeFile(join(root, "watch-disk.md"), "edited-on-disk", "utf8");
      diskCallback?.();
      await pollTick?.();
      await watchPromise;

      const read = await vfs.read("/watch-disk.md");
      assert.equal(read.content, "edited-on-disk");
    });
    await conn.close();
  });

  it("T7: VFS change triggers push after debounce", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await withTempMirror(async (root, config) => {
      await vfs.write("/watch-vfs.md", "initial");
      await push(vfs, config);

      let pollCallback: (() => void | Promise<void>) | null = null;
      const driver: WatchDriver = {
        watchDisk(_onChange) {
          return { close() {} };
        },
        startVfsPoll(onTick, _pollMs) {
          pollCallback = onTick;
          return { stop() {} };
        },
      };

      const engine = createSyncEngine(vfs, config);
      const watchPromise = runWatch({
        config,
        engine,
        vfs,
        driver,
        once: true,
      });

      await vfs.write("/watch-vfs.md", "edited-in-vfs", {
        versionCheck: false,
      });
      await pollCallback?.();
      await watchPromise;

      const disk = await readFile(join(root, "watch-vfs.md"), "utf8");
      assert.equal(disk, "edited-in-vfs");
    });
    await conn.close();
  });
});
