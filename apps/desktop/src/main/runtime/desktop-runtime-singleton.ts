/**
 * Main-process runtime singleton lifecycle.
 * Invariant: one open DB + service graph per app session; rebootstrap closes first.
 */
import { closeDesktopConnection } from "./connection.js";
import { createDesktopNovelMasterRuntime } from "./create-desktop-runtime.js";
import type { DesktopNovelMasterRuntime } from "./types.js";

let runtime: DesktopNovelMasterRuntime | undefined;
let initPromise: Promise<DesktopNovelMasterRuntime> | undefined;

/** Returns the shared runtime, creating it on first call. */
export async function getDesktopRuntime(): Promise<DesktopNovelMasterRuntime> {
  if (runtime) {
    return runtime;
  }
  if (!initPromise) {
    initPromise = createDesktopNovelMasterRuntime().then((rt) => {
      runtime = rt;
      return rt;
    });
  }
  return initPromise;
}

/** Synchronous access when handlers know bootstrap already completed. */
export function getDesktopRuntimeOrThrow(): DesktopNovelMasterRuntime {
  if (!runtime) {
    throw new Error("Desktop runtime not initialized");
  }
  return runtime;
}

/** Closes DB and rebuilds the full service graph (backup import, etc.). */
export async function rebootstrapDesktopRuntime(): Promise<DesktopNovelMasterRuntime> {
  await resetDesktopRuntimeForTest();
  return getDesktopRuntime();
}

/**
 * Drop the runtime handle without closing the DB.
 * Call immediately before `closeDesktopConnection` during backup import so
 * concurrent IPC cannot observe a closed `runtime.conn` (better-sqlite3 abort).
 */
export function clearDesktopRuntimeHandle(): void {
  runtime = undefined;
  initPromise = undefined;
}

/** Clears singleton state between integration tests (system Node host). */
export async function resetDesktopRuntimeForTest(): Promise<void> {
  await closeDesktopConnection();
  clearDesktopRuntimeHandle();
}
