/**
 * workspace-push 菜单测试的模块重定向钩子：
 * - ShellNavProvider → nav-stub（useShellNav 从 globalThis 读导航状态）
 * - ContextMenu → context-menu-stub（去 portal 化，items 渲染成普通树）
 * 拦截原始 specifier（含 @/ 别名形态），兼容 tsx paths 解析前后的到达形态。
 */
const navStubUrl = new URL("./workspace-push-nav-stub.mjs", import.meta.url).href;
const menuStubUrl = new URL(
  "./workspace-push-context-menu-stub.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/providers/ShellNavProvider" ||
    specifier.endsWith("providers/ShellNavProvider") ||
    specifier.endsWith("providers/ShellNavProvider.tsx")
  ) {
    return { shortCircuit: true, url: navStubUrl };
  }
  if (
    specifier === "@/components/ui/ContextMenu" ||
    specifier.endsWith("ui/ContextMenu") ||
    specifier.endsWith("ui/ContextMenu.tsx")
  ) {
    return { shortCircuit: true, url: menuStubUrl };
  }
  return nextResolve(specifier, context);
}
