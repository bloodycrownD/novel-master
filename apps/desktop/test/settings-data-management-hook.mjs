/**
 * 设置页数据管理取消用例的模块重定向钩子：
 * `@/providers/NovelMasterProvider` → 只返回 `{ retry }` 的替身，避免真实
 * Provider 的 bootstrap IPC 把设置页子树挡在 loading 后面。
 */
const stubUrl = new URL("./settings-data-management-provider-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("providers/NovelMasterProvider") || specifier.endsWith("providers/NovelMasterProvider.tsx")) {
    return { shortCircuit: true, url: stubUrl };
  }
  return nextResolve(specifier, context);
}
