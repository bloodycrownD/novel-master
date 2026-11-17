/**
 * FileEditor 的「session 域保存成功」回调存取（模块级单例）。
 *
 * React Navigation 路由参数要求可序列化，函数放进 params 会在状态持久化 /
 * 深链解析时被丢弃（并触发 "Non-serializable values" 警告）。仓内既有的
 * `prompt-editor-callback` 就是这条范式，本模块逐字照它的形状：
 * push 前写入、挂载时读走。
 *
 * 为什么不复用 prompt-editor-callback 本身：它的签名是 `(text: string) => void`，
 * 语义（编辑回填）与取值时机都不同。
 */

import {createCallbackSlot} from '../../runtime/callback-slot';

const slot = createCallbackSlot<() => void>();

/** push 前写入当次回调（每次打开都覆盖新回调）。 */
// nm-style: keep-public — 槽实例保持模块私有；set/take 是跨屏导航的唯一存取口
export function setFileEditorOnSessionVfsSaved(cb: () => void) {
  slot.set(cb);
}

/** 挂载时读取并清空：take 语义避免上一次打开的回调泄漏到下一次。 */
// nm-style: keep-public — 槽实例保持模块私有；set/take 是跨屏导航的唯一存取口
export function takeFileEditorOnSessionVfsSaved(): (() => void) | null {
  return slot.take();
}
