/**
 * N-P1-04 压缩防抖用例的模块重定向钩子：ShellNavProvider → no-op stub。
 * 形态对齐 chat-search-shell-nav-hook.mjs。
 */
const navStubUrl = new URL(
  "./workspace-settings-shell-nav-stub.mjs",
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
  return nextResolve(specifier, context);
}
