/**
 * desktop-runtime-singleton 的测试替身（sessions push IPC 测试用）：
 * runtime 从 globalThis.__sessionsPushTestRuntime 取，由测试文件在用例前设置。
 *
 * 返回值形态对齐真实 `getDesktopRuntime()`——错误通道迁移后它回
 * `Result<DesktopNovelMasterRuntime, AppError>`，handler 侧先看 `built.ok`
 * 再取 `built.value`，所以替身也必须包一层成功侧（裸对象会让 `built.ok`
 * 恒为 undefined，handler 直接短路成失败）。
 */
export async function getDesktopRuntime() {
  const rt = globalThis.__sessionsPushTestRuntime;
  if (rt == null) {
    throw new Error("测试未设置 globalThis.__sessionsPushTestRuntime");
  }
  return { ok: true, value: rt };
}
