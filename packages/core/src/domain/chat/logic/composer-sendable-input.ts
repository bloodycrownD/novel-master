/**
 * Composer 空发送判定（与 Spec / runAgentTurn hasInput 对齐）。
 *
 * 可发条件：`trim(text)` 非空 | attach 数>0 | hasPendingUserOps |
 * 有未发送批注（`hasAnnotateDrafts`）。
 * 规则差集 / `hasWorkplaceDelta` 已废止（composer-chip-ops-annotate-recontract）。
 *
 * @module domain/chat/logic/composer-sendable-input
 */

export type ComposerSendableInput = {
  readonly text: string;
  readonly attachmentCount: number;
  readonly hasPendingUserOps: boolean;
  /**
   * 本会话存在未发送批注草稿。
   * **Core 布尔语义不变**：仅消费调用方传入的布尔值。
   * App 侧应对文件批注 store 与消息批注 store **取或** 后再传入
   *（`hasChatAnnotateDrafts(sessionId)`）。
   * 可选；为 true 时允许仅批注发送。
   */
  readonly hasAnnotateDrafts?: boolean;
};

/**
 * `trim(text)` 非空 **或** `attachments.length > 0` **或** pending→将产生 `user_ops`
 * **或** 有批注草稿 → 等价于有输入（可不要求文字）。
 */
export function hasComposerSendableInput(input: ComposerSendableInput): boolean {
  return (
    input.text.trim() !== "" ||
    input.attachmentCount > 0 ||
    input.hasPendingUserOps ||
    input.hasAnnotateDrafts === true
  );
}
