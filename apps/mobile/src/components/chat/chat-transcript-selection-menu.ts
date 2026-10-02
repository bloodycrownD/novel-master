/**
 * transcript 划词选区菜单（消息批注已移除；勿与文件预览常量混用）。
 * 自定义项会盖掉原生 Copy，故须自备「复制」。
 *
 * 两份常量并存的原因（chat-webview-unify Step 6 · transcript-converge 后）：
 * - `CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS`（仅「复制」）归统一宿主的
 *   **transcriptOnly 变体**（子会话屏）——无 dock 时全选/粘贴的跨桥动作没有
 *   落点，三项反而制造死按钮。
 * - `CHAT_CONVERSATION_SELECTION_MENU_ITEMS`（复制/全选/粘贴）归统一宿主的
 *   **完整形态**（主对话链）——合并后单实例只有一套 `menuItems`，输入框因此
 *   保住了原生菜单的核心三项。
 *
 * 「全选」「粘贴」是跨桥动作（下行 dock 域 `selectAll` / `composerPaste`），
 * 只在完整形态接；transcriptOnly 变体不消费这两个 key。
 */

/** 旧转录宿主用：仅「复制」。 */
export const CHAT_TRANSCRIPT_SELECTION_MENU_ITEMS = [
  {label: '复制', key: 'copy'},
] as const;

/**
 * 统一宿主用：复制 / 全选 / 粘贴（spec §划词菜单）。
 *
 * 已知外溢（spec 风险表已记）：运行态（uiRunning）输入框选词复制同被禁——Android
 * 的回调不带 DOM 上下文，宿主无法区分选区来源，保留转录区行为优先。
 */
export const CHAT_CONVERSATION_SELECTION_MENU_ITEMS = [
  {label: '复制', key: 'copy'},
  {label: '全选', key: 'selectAll'},
  {label: '粘贴', key: 'paste'},
] as const;
