/**
 * MermaidMarkdown 的测试替身（RealPromptPanel 全屏 Modal 断言用）。
 *
 * 真组件内部按 `documentElement` 挂 MutationObserver、且 mermaid 块走
 * `document.getElementById` 的动态渲染，在 node --test（react-test-renderer，
 * 无真实 DOM）下跑不动。本轮验收点「Modal 正文跑的是 MermaidMarkdown、传的
 * content 是不是那份卡片正文」全部落在**props 形状**上，替身把收到的 props 记到
 * globalThis 上供断言，并渲染一个带 data-* 标记的占位节点，保留「挂没挂 / 传了什么」
 * 的可见性。MermaidMarkdown 自身行为由既有的 mermaid-markdown.test.tsx 覆盖。
 */
import { createElement } from "react";

export function MermaidMarkdown(props) {
  const g = globalThis;
  g.__promptTurnMermaidProps = g.__promptTurnMermaidProps ?? [];
  g.__promptTurnMermaidProps.push(props);
  return createElement("div", {
    "data-mermaid-stub": "true",
    "data-content-length": String(props.content?.length ?? 0),
  });
}
