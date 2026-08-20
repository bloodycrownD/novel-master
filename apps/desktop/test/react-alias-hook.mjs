/**
 * T-CF7 竞态用例专用的 react 解析钩子。
 *
 * 背景：根 node_modules 的 react-test-renderer@19.2.3（传递依赖）与它绑定的
 * 根 node_modules/react@19.2.3 是同一副本；而桌面工作区自带
 * apps/desktop/node_modules/react@19.2.7。若组件用工作区副本、renderer 用根副本，
 * hooks dispatcher 会是 null（"Cannot read properties of null (reading 'useState')"）。
 *
 * 做法：把本测试文件动态导入子树里的 react（含 react/jsx-*）统一重定向到根副本，
 * 让 ChatHistorySearchPanel 及其依赖与 react-test-renderer 跑在同一份 react 上。
 * 钩子只在该测试文件内 register，且静态导入先于 register 完成，不影响其它测试。
 */
const rootParent = new URL("../../../package.json", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react" || specifier.startsWith("react/")) {
    return nextResolve(specifier, { ...context, parentURL: rootParent.href });
  }
  return nextResolve(specifier, context);
}
