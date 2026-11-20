/**
 * Main-process runtime singleton lifecycle.
 * Invariant: one open DB + service graph per app session; rebootstrap closes first.
 */
import type { AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import { DesktopDb } from "./connection.js";
import { DesktopRuntimeFactory } from "./create-desktop-runtime.js";
import type { DesktopNovelMasterRuntime } from "./types.js";

let runtime: DesktopNovelMasterRuntime | undefined;
let initPromise: Promise<Result<DesktopNovelMasterRuntime, AppError>> | undefined;

export namespace DesktopRuntimeSingleton {
  /**
   * Returns the shared runtime, creating it on first call.
   * 装配的已知失败沿 `Result.err` 上行（错误通道迁移七期），消费方按各自
   * 通道收口（IPC 经 toIpcResult / formatIpcError；进程级 bootstrap 落日志）；
   * 未知的装配异常仍走 rejection 通道。
   */
  export async function get(): Promise<Result<DesktopNovelMasterRuntime, AppError>> {
    if (runtime) {
      return Result.ok(runtime);
    }
    if (!initPromise) {
      initPromise = DesktopRuntimeFactory.create().then((built) => {
        if (built.ok) {
          runtime = built.value;
        }
        return built;
      });
    }
    return initPromise;
  }

  /** Synchronous access when handlers know bootstrap already completed. */
  export function getOrThrow(): DesktopNovelMasterRuntime {
    if (!runtime) {
      // nm-throw: keep — 同步访问器的不变量：调用方契约保证 bootstrap 已完成（名字即契约），未初始化属编程错误。
      throw new Error("Desktop runtime not initialized");
    }
    return runtime;
  }

  /** Closes DB and rebuilds the full service graph (backup import, etc.). */
  export async function rebootstrap(): Promise<Result<DesktopNovelMasterRuntime, AppError>> {
    await resetForTest();
    return get();
  }

  /**
   * Drop the runtime handle without closing the DB.
   * Call immediately before `DesktopDb.close` during backup import so
   * concurrent IPC cannot observe a closed `runtime.conn` (better-sqlite3 abort).
   */
  export function clearHandle(): void {
    runtime = undefined;
    initPromise = undefined;
  }

  /** Clears singleton state between integration tests (system Node host). */
  export async function resetForTest(): Promise<void> {
    await DesktopDb.close();
    clearHandle();
  }
}
