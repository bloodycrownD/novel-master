/**
 * transcript 划词选区菜单（消息批注已移除；勿与文件预览常量混用）。
 * 自定义项会盖掉原生 Copy，故须自备「复制」。
 *
 * 只有「复制」一项（chat-webview-unify Step 6 · transcript-converge 后）：
 * 统一宿主的 **transcriptOnly 变体**（子会话屏）与纯转录宿主（composer-native
 * 迭代后主对话链输入框已 RN 原生化、无 web dock）都没有跨桥动作的落点——
 * 「全选 / 粘贴」曾走的 dock 域下行（`selectAll` / `composerPaste`）已随 D4c
 * 退役，三项菜单只剩「复制」有消费语义（原完整形态三项常量
 * `CHAT_CONVERSATION_SELECTION_MENU_ITEMS` 已随死导出清除）。
 */

/** 转录宿主用：仅「复制」。 */
export const CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS = [
  {label: '复制', key: 'copy'},
] as const;
