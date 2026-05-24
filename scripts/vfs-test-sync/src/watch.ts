import { watch } from "node:fs";
import type { VfsService } from "@novel-master/core";
import type { SyncConfig } from "./config.js";
import type { SyncEngine } from "./sync-engine.js";

/** Milliseconds to ignore disk events after script writes the mirror (echo suppression). */
const ECHO_SUPPRESS_MS = 100;

/** Disk change notification source (real fs.watch or test double). */
export interface DiskWatchHandle {
  close(): void;
}

/** Injectable driver for watch tests (T6–T7). */
export interface WatchDriver {
  watchDisk(onChange: () => void): DiskWatchHandle;
  startVfsPoll(onTick: () => void | Promise<void>, pollMs: number): {
    stop(): void;
  };
}

export interface WatchOptions {
  readonly config: SyncConfig;
  readonly engine: SyncEngine;
  readonly vfs: VfsService;
  readonly driver?: WatchDriver;
  readonly once?: boolean;
}

type VfsSnapshot = Map<string, { version: number; mtimeMs: number }>;

/**
 * Captures VFS path version/mtime pairs under the configured prefix.
 */
export async function snapshotVfs(
  vfs: VfsService,
  prefix: string,
): Promise<VfsSnapshot> {
  const snap = new Map<string, { version: number; mtimeMs: number }>();
  const paths = await vfs.glob("**/*", { cwd: prefix });
  for (const path of paths) {
    const meta = await vfs.read(path);
    snap.set(path, { version: meta.version, mtimeMs: meta.mtimeMs });
  }
  return snap;
}

/** Returns true when two VFS snapshots differ. */
export function vfsSnapshotChanged(
  previous: VfsSnapshot,
  current: VfsSnapshot,
): boolean {
  if (previous.size !== current.size) {
    return true;
  }
  for (const [path, prevMeta] of previous) {
    const curMeta = current.get(path);
    if (curMeta == null) {
      return true;
    }
    if (
      curMeta.version !== prevMeta.version ||
      curMeta.mtimeMs !== prevMeta.mtimeMs
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Trailing debounce scheduler: coalesces disk/VFS triggers within one window.
 * When both sides change in the same window, runs pull then push (disk wins).
 */
export function createDebouncedSyncScheduler(
  engine: SyncEngine,
  debounceMs: number,
): {
  schedule(source: "disk" | "vfs"): void;
  flush(): Promise<void>;
  isSyncing(): boolean;
  getSuppressUntil(): number;
} {
  let diskPending = false;
  let vfsPending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let suppressUntil = 0;
  let flushPromise: Promise<void> | null = null;

  async function runSync(): Promise<void> {
    if (syncing) {
      return;
    }
    const doDisk = diskPending;
    const doVfs = vfsPending;
    if (!doDisk && !doVfs) {
      return;
    }

    diskPending = false;
    vfsPending = false;
    syncing = true;

    try {
      if (doDisk && doVfs) {
        suppressUntil = Date.now() + ECHO_SUPPRESS_MS;
        await engine.pull();
        suppressUntil = Date.now() + ECHO_SUPPRESS_MS;
        await engine.push();
      } else if (doDisk) {
        suppressUntil = Date.now() + ECHO_SUPPRESS_MS;
        await engine.pull();
      } else if (doVfs) {
        suppressUntil = Date.now() + ECHO_SUPPRESS_MS;
        await engine.push();
      }
    } finally {
      syncing = false;
    }
  }

  function schedule(source: "disk" | "vfs"): void {
    if (syncing) {
      return;
    }
    if (source === "disk") {
      diskPending = true;
    } else {
      vfsPending = true;
    }
    if (debounceTimer != null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushPromise = runSync();
    }, debounceMs);
  }

  async function flush(): Promise<void> {
    if (debounceTimer != null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await runSync();
    if (flushPromise != null) {
      await flushPromise;
      flushPromise = null;
    }
  }

  return {
    schedule,
    flush,
    isSyncing: () => syncing,
    getSuppressUntil: () => suppressUntil,
  };
}

/**
 * Starts native recursive fs.watch; falls back to chokidar when unavailable.
 */
export async function createDefaultDiskWatcher(
  mirrorRoot: string,
  onChange: () => void,
  onError?: (err: unknown) => void,
): Promise<DiskWatchHandle> {
  try {
    const watcher = watch(
      mirrorRoot,
      { recursive: true },
      () => onChange(),
    );
    watcher.on("error", (err) => onError?.(err));
    return {
      close() {
        watcher.close();
      },
    };
  } catch {
    const chokidar = await import("chokidar");
    const watcher = chokidar.watch(mirrorRoot, {
      ignoreInitial: true,
      ignored: (path: string) =>
        path.includes(`${mirrorRoot}\\.git`) ||
        path.includes(`${mirrorRoot}/.git`),
    });
    watcher.on("all", () => onChange());
    watcher.on("error", (err) => onError?.(err));
    return {
      close() {
        void watcher.close();
      },
    };
  }
}

/**
 * Runs bidirectional watch: disk changes → pull, VFS poll changes → push.
 * Foreground process until SIGINT (or `--once` for a single poll cycle in tests).
 */
export async function runWatch(options: WatchOptions): Promise<void> {
  const { config, engine, vfs, once = false } = options;
  const scheduler = createDebouncedSyncScheduler(engine, config.debounceMs);
  let vfsSnapshot = await snapshotVfs(vfs, config.prefix);

  let diskHandle: DiskWatchHandle;
  let pollHandle: { stop(): void };

  if (options.driver) {
    diskHandle = options.driver.watchDisk(() => {
      if (Date.now() < scheduler.getSuppressUntil()) {
        return;
      }
      scheduler.schedule("disk");
    });
    pollHandle = options.driver.startVfsPoll(async () => {
      await pollTick();
    }, config.pollMs);
  } else {
    diskHandle = await createDefaultDiskWatcher(config.mirrorRoot, () => {
      if (Date.now() < scheduler.getSuppressUntil()) {
        return;
      }
      scheduler.schedule("disk");
    });
    const timer = setInterval(() => {
      void pollTick();
    }, config.pollMs);
    pollHandle = {
      stop() {
        clearInterval(timer);
      },
    };
  }

  let pollCount = 0;
  let stopped = false;

  async function pollTick(): Promise<void> {
    const next = await snapshotVfs(vfs, config.prefix);
    if (vfsSnapshotChanged(vfsSnapshot, next)) {
      vfsSnapshot = next;
      scheduler.schedule("vfs");
    } else {
      vfsSnapshot = next;
    }

    pollCount++;
    if (once && pollCount >= 1) {
      await scheduler.flush();
      if (!stopped) {
        stopped = true;
        pollHandle.stop();
        diskHandle.close();
      }
    }
  }

  if (once) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      if (!stopped) {
        stopped = true;
        pollHandle.stop();
        diskHandle.close();
      }
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}
