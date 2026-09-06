/**
 * ShellNavProvider 的测试替身 hook（workspace-push 菜单测试用）：
 * useShellNav 返回值从 globalThis.__workspacePushNavState 取，
 * 由测试文件在渲染前设置（可切换子会话/主会话视图）。
 */
export function useShellNav() {
  const state = globalThis.__workspacePushNavState;
  if (state == null) {
    throw new Error("测试未设置 globalThis.__workspacePushNavState");
  }
  return state;
}
