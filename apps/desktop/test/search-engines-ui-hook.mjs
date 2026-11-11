/**
 * 搜索配置双页测试（T-U1/T-U2）的模块重定向钩子：ContextMenu → 去 portal 替身。
 *
 * react-test-renderer 没有真实 DOM 容器，`createPortal` 渲染不出来；替身与
 * 真实组件同形的 items 按钮树（复用 workspace-push 用例的 ContextMenu stub，
 * 行为一致：点击先 onClose 再 onSelect）。
 */
const menuStubUrl = new URL(
  "./workspace-push-context-menu-stub.mjs",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/components/ui/ContextMenu" ||
    specifier.endsWith("ui/ContextMenu") ||
    specifier.endsWith("ui/ContextMenu.tsx")
  ) {
    return { shortCircuit: true, url: menuStubUrl };
  }
  return nextResolve(specifier, context);
}
