/**
 * CodeEditor 的测试替身（T-R6：assistant 轮详情 Modal 挂载断言用）。
 *
 * 真实 CodeEditor 拉 @uiw/react-codemirror + 全部 codemirror 扩展，需要真实
 * DOM（document/ResizeObserver），在 node --test 环境里跑不动；本轮验收点
 * 「Modal 内挂的是只读 CodeEditor、value 即 turn.body、不挂 onChange」全部落在
 * **props 形状**上，替身把收到的 props 记到 globalThis 上供断言，并渲染一个
 * 带 data-* 标记的占位节点，保留「挂没挂」的可见性。
 * CodeEditor 自身的 readOnly 实现由源码级断言覆盖（见测试文件末段）。
 */
import { createElement } from "react";

export function CodeEditor(props) {
  const g = globalThis;
  g.__promptTurnCodeEditorProps = g.__promptTurnCodeEditorProps ?? [];
  g.__promptTurnCodeEditorProps.push(props);
  return createElement("div", {
    "data-code-editor": "stub",
    "data-read-only": props.readOnly === true ? "true" : "false",
    "data-language-path": props.languagePath ?? "",
  });
}
