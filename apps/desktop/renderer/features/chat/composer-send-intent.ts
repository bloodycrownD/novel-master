/**
 * Desktop Composer 发送门闩 / 入参清洗（T-SR1 / T-SR1b）。
 * 与 ChatComposer.send / sendDisabled 同源；workplace 预览不进 payload。
 */
import type { MessageAttachmentDto } from "@shared/ipc-types";
import { hasComposerSendableInput } from "@novel-master/core/chat";
import { partitionComposerChipAttachments } from "./AttachmentDraftChips";

export type ComposerSendIntentInput = {
  text: string;
  attachments: readonly MessageAttachmentDto[];
  hasPendingUserOps: boolean;
  canResumeWithoutInput: boolean;
  /** 默认 true（测门闩时）；组件内以模型探测为准。 */
  hasModel?: boolean;
  running?: boolean;
};

export type ComposerSendIntent = {
  hasSendable: boolean;
  allowResumeWithoutInput: boolean;
  /** 显式 attachments 仅 attach；空则 IPC 省略该字段。 */
  attachOnly: MessageAttachmentDto[];
  hasWorkplaceDelta: boolean;
  sendDisabled: boolean;
};

export function resolveComposerSendIntent(
  input: ComposerSendIntentInput,
): ComposerSendIntent {
  const content = input.text.trim();
  const { attach: attachOnly } = partitionComposerChipAttachments(
    input.attachments,
  );
  const hasWorkplaceDelta = input.attachments.some(
    (a) => a.source === "workplace",
  );
  const hasSendable = hasComposerSendableInput({
    text: content,
    attachmentCount: attachOnly.length,
    hasPendingUserOps: input.hasPendingUserOps,
    hasWorkplaceDelta,
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
    attachOnly,
    hasWorkplaceDelta,
    sendDisabled,
  };
}
