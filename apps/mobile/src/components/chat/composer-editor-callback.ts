/**
 * chat 输入框全屏编辑（ChatComposerEditorScreen）的存取（模块级单例）。
 * 照 `components/agent/prompt-editor-callback.ts` 先例：React Navigation 路由
 * 参数要求可序列化，回调放进 params 会触发 "Non-serializable values" 警告，
 * 因此回调不走路由——打开方（ChatTabScreen）在 navigate 前写入，全屏屏挂载
 * 时读走（读后即清，防串台）。
 *
 * 取消路径不消费：未点「保存」就返回时这条回调随 take 后的局部引用一起丢弃，
 * 原输入文本不受影响。
 */

export type ComposerEditorOnSaved = (text: string) => void;

export type ComposerEditorPending = {
  /** 进入全屏时的初始文本（当前输入框内容）。 */
  readonly initialText: string;
  /** 保存回填：全屏屏点「保存」时以草稿文本回调（只走一次）。 */
  readonly onSaved: ComposerEditorOnSaved;
};

let pending: ComposerEditorPending | null = null;

/** navigate 前写入当次会话（每次打开全屏都覆盖，旧值不会被再次消费）。 */
export function setComposerEditorCallback(next: ComposerEditorPending): void {
  pending = next;
}

/** 挂载时读取并清空：take 语义避免残留旧回调串到下一次打开。 */
export function takeComposerEditorCallback(): ComposerEditorPending | null {
  const current = pending;
  pending = null;
  return current;
}
