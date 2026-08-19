/**
 * rich-document WebView mermaid 渲染 runtime（无 JSX）。
 * main.ts 在每次 setDocument 视图刷新后调用 renderMermaidBlocks：
 * 扫描消毒后正文里的 language-mermaid 代码块，bundle 内 mermaid 渲染 SVG 插入，
 * 源码 <pre> 移入 display:none 保留容器（批注文本流不偏移）；失败保留源码 + 失败类名。
 * 主题按 --bg 亮度推断 dark/default；主题切换重扫为已知限制（见 spec 风险节）。
 */
import {
  createMermaidSourceCache,
  renderMermaidCodeBlocks,
} from '@web/shared/mermaid-core';

const mermaidCache = createMermaidSourceCache();

/** 扫描并渲染 root 下未处理的 mermaid 块（文档刷新整树重建，缓存按源码去重）。 */
export async function renderMermaidBlocks(root: ParentNode): Promise<void> {
  await renderMermaidCodeBlocks(root, mermaidCache);
}
