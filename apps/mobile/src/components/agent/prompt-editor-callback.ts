/**
 * 全屏提示词编辑的回调存取（模块级单例）。
 * React Navigation 路由参数要求可序列化，函数放进 params 会触发
 * "Non-serializable values" 警告，因此回调不走路由：AgentEditorForm
 * 在 push 前写入，PromptEditorScreen 挂载时读走（读后即清，防串台）。
 */

import {createCallbackSlot} from '../../runtime/callback-slot';

export type PromptEditorOnSaved = (text: string) => void;

const slot = createCallbackSlot<PromptEditorOnSaved>();

/** push 前写入当次回调（闭包捕获当次 setter；每次打开全屏都覆盖新回调）。 */
// nm-style: keep-public — 槽实例保持模块私有；set/take 是跨屏导航的唯一存取口
export function setPromptEditorOnSaved(cb: PromptEditorOnSaved) {
  slot.set(cb);
}

/** 挂载时读取并清空：take 语义避免残留旧回调（取消路径不消费即丢弃）。 */
// nm-style: keep-public — 槽实例保持模块私有；set/take 是跨屏导航的唯一存取口
export function takePromptEditorOnSaved(): PromptEditorOnSaved | null {
  return slot.take();
}
