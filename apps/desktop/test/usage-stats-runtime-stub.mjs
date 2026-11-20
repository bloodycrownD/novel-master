/**
 * desktop-runtime-singleton 的测试替身（usage-stats IPC 测试用）：
 * runtime 从 globalThis.__usageStatsTestRuntime 取，由测试文件在用例前设置。
 *
 * 错误通道迁移七期起真实 `getDesktopRuntime()` 返回
 * `Result<DesktopNovelMasterRuntime, AppError>`，handler 按 `built.ok` 短路；
 * 替身必须同契约回 `Result.ok(rt)`——裸 runtime 没有 `ok` 字段，会被 handler
 * 误判成装配失败（Err(undefined) → INFRA_UNEXPECTED_ERROR）。
 */
import { Result } from "@novel-master/core/errors";

export const DesktopRuntimeSingleton = {
  async get() {
    const rt = globalThis.__usageStatsTestRuntime;
    if (rt == null) {
      throw new Error("测试未设置 globalThis.__usageStatsTestRuntime");
    }
    return Result.ok(rt);
  },
};
