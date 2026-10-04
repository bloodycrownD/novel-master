/**
 * ShellNavProvider 的测试替身 hook（N-P1-04 压缩防抖用例用）：
 * WorkspaceSettingsView 消费 useShellNav().notifyAgentConfigChanged，
 * 本测试真渲组件但不挂完整 provider（依赖整个桌面导航栈）。
 * 形态对齐 settings-overlay-views-stub.ts。
 */
export function useShellNav() {
  return { notifyAgentConfigChanged: () => {}, openChatLink: () => {} };
}
