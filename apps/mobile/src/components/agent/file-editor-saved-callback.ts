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

/**
 * 模块级单槽：push 前 `set`（每次打开都覆盖新回调）、挂载时 `take`
 * （读后即清，避免上一次打开的回调泄漏到下一次）。
 */
export const fileEditorOnSessionVfsSavedSlot = createCallbackSlot<() => void>();
