/**
 * Composer 空发送判定（与 Spec / runAgentTurn hasInput 对齐）。
 *
 * @module domain/chat/logic/composer-sendable-input
 */

/**
 * `trim(text)` 非空 **或** `attachments.length > 0` **或** pending→将产生 `user_ops`
 * → 等价于有输入（可不要求文字）。
 */
export function hasComposerSendableInput(input: {
  readonly text: string;
  readonly attachmentCount: number;
  readonly hasPendingUserOps: boolean;
}): boolean {
  return (
    input.text.trim() !== "" ||
    input.attachmentCount > 0 ||
    input.hasPendingUserOps
  );
}
