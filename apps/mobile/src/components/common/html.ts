/**
 * HTML 实体转义：`&` `<` `>` `"` 四个实体（不处理单引号，保持历史输出逐字节一致）。
 *
 * 不放 `packages/core/src/common`：composer-input WebView 的产物门禁要求零 core 模块
 * （build-webview.mjs 门 B，旧 WebView 曾被 core barrel 顶层构造打崩），故留在 RN 侧
 * 公共目录，供 composer-input runtime 与 RN 组件共用。
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
