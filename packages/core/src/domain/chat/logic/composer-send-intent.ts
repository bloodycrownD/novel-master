/**
 * Composer 发送门闩 / 入参清洗（T-SR1 / T-ATD*）。
 * 文件引用以正文 `@` 扫描为准；draft attach 恒空；workplace 预览不进 payload。
 *
 * @module domain/chat/logic/composer-send-intent
 */

import { hasComposerSendableInput } from "./composer-sendable-input.js";
import { scanAtPathAttachments } from "./scan-at-path-attachments.js";

/** 门闩只读 `source`；与 MessageAttachment / DTO 结构兼容。 */
export type ComposerSendIntentAttachment = {
  readonly source: string;
};

export type ComposerSendIntentInput = {
  text: string;
  attachments: readonly ComposerSendIntentAttachment[];
  hasPendingUserOps: boolean;
  canResumeWithoutInput: boolean;
  /** 本会话有未发送批注草稿（须透传 hasComposerSendableInput）。 */
  hasAnnotateDrafts?: boolean;
  /** 默认 true（测门闩时）；组件内以模型探测为准。 */
  hasModel?: boolean;
  running?: boolean;
};

export type ComposerSendIntent = {
  hasSendable: boolean;
  allowResumeWithoutInput: boolean;
  /** 显式 attachments 恒空；Core 从正文扫描 `@`。 */
  attachOnly: readonly [];
  hasWorkplaceDelta: boolean;
  sendDisabled: boolean;
};

export function resolveComposerSendIntent(
  input: ComposerSendIntentInput,
): ComposerSendIntent {
  const content = input.text.trim();
  const scannedCount = scanAtPathAttachments(input.text).length;
  const hasWorkplaceDelta = input.attachments.some(
    (a) => a.source === "workplace",
  );
  const hasSendable = hasComposerSendableInput({
    text: content,
    attachmentCount: scannedCount,
    hasPendingUserOps: input.hasPendingUserOps,
    hasWorkplaceDelta,
    hasAnnotateDrafts: input.hasAnnotateDrafts === true,
  });
  const allowResumeWithoutInput =
    !hasSendable && input.canResumeWithoutInput;
  const hasModel = input.hasModel !== false;
  const running = input.running === true;
  const sendDisabled =
    !hasModel ||
    (!running && !hasSendable && !input.canResumeWithoutInput);
  return {
    hasSendable,
    allowResumeWithoutInput,
    attachOnly: [],
    hasWorkplaceDelta,
    sendDisabled,
  };
}
