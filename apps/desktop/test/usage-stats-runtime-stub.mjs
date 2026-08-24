/**
 * desktop-runtime-singleton 的测试替身（usage-stats IPC 测试用）：
 * runtime 从 globalThis.__usageStatsTestRuntime 取，由测试文件在用例前设置。
 */
export async function getDesktopRuntime() {
  const rt = globalThis.__usageStatsTestRuntime;
  if (rt == null) {
    throw new Error("测试未设置 globalThis.__usageStatsTestRuntime");
  }
  return rt;
}
