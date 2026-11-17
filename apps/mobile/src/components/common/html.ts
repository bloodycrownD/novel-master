/**
 * HTML 实体转义：`&` `<` `>` `"` 四个实体（不处理单引号，保持历史输出逐字节一致）。
 *
 * 这是 `core/common/text.ts` 的 `Text.escapeHtml` 在 mobile 侧的**镜像实现**
 * （同一组实体、同一替换顺序）：composer-input WebView 的产物门禁
 * （build-webview.mjs 门 B，`composer-input` 白名单为空）要求零 core 模块，
 * 故本文件必须保持 core-free，不能改成薄再导出。改这里时同步 `Text.escapeHtml`。
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
