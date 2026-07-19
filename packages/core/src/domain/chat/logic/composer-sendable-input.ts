/**
 * Composer 空发送判定（与 Spec / runAgentTurn hasInput 对齐）。
 *
 * 可发条件：`trim(text)` 非空 | attach 数>0 | hasPendingUserOps |
 * 状态条有 workplace 差集（`hasWorkplaceDelta`）| 有未发送批注（`hasAnnotateDrafts`）。
 *
 * @module domain/chat/logic/composer-sendable-input
 */

export type ComposerSendableInput = {
  readonly text: string;
  readonly attachmentCount: number;
  readonly hasPendingUserOps: boolean;
  /**
   * 状态条存在 `source:workplace`（或 Core 算出的 workplace 差集非空）。
   * 可选；缺省视为 `false`，与旧调用兼容。
   */
  readonly hasWorkplaceDelta?: boolean;
  /**
   * 本会话存在未发送批注草稿（App annotateStore）。
   * 可选；为 true 时允许仅批注发送。
   */
  readonly hasAnnotateDrafts?: boolean;
};

/**
 * `trim(text)` 非空 **或** `attachments.length > 0` **或** pending→将产生 `user_ops`
 * **或** workplace 差集 **或** 有批注草稿 → 等价于有输入（可不要求文字）。
 */
export function hasComposerSendableInput(input: ComposerSendableInput): boolean {
  return (
    input.text.trim() !== "" ||
    input.attachmentCount > 0 ||
    input.hasPendingUserOps ||
    input.hasWorkplaceDelta === true ||
    input.hasAnnotateDrafts === true
  );
}
