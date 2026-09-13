/**
 * ShellNavProvider 的测试替身 hook（T-CF7 搜索面板竞态用例用）：
 * MF-12 起 ChatHistorySearchPanel 消费 useShellNav().openChatLink，
 * 本测试真渲面板但不挂完整 provider（依赖整个桌面导航栈）——
 * stub 只提供 no-op openChatLink，保持竞态用例聚焦请求时序。
 * 形态对齐 workspace-push-nav-stub.mjs 先例。
 */
export function useShellNav() {
  return { openChatLink: () => {} };
}
