/**
 * T-CF7 竞态用例的模块重定向钩子：ShellNavProvider → no-op stub。
 * 拦截原始 specifier（含 @/ 别名形态），兼容 tsx paths 解析前后的到达形态，
 * 形态对齐 workspace-push-ui-hook.mjs 先例。
 */
const navStubUrl = new URL("./chat-search-shell-nav-stub.mjs", import.meta.url)
  .href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/providers/ShellNavProvider" ||
    specifier.endsWith("providers/ShellNavProvider") ||
    specifier.endsWith("providers/ShellNavProvider.tsx")
  ) {
    return { shortCircuit: true, url: navStubUrl };
  }
  return nextResolve(specifier, context);
}
