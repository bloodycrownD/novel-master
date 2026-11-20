/**
 * desktop-runtime-singleton 的测试替身（取消链路 IPC 测试用）：
 * runtime 从 globalThis.__runAbortTestRuntime 取，由测试文件在用例前设置。
 *
 * 与 usage-stats-runtime-stub.mjs 同契约：真实 `getDesktopRuntime()` 返回
 * `Result<DesktopNovelMasterRuntime, AppError>`，替身必须同形回 `Result.ok(rt)`。
 */
import { Result } from "@novel-master/core/errors";

export const DesktopRuntimeSingleton = {
  async get() {
    const rt = globalThis.__runAbortTestRuntime;
    if (rt == null) {
      throw new Error("测试未设置 globalThis.__runAbortTestRuntime");
    }
    return Result.ok(rt);
  },
};
