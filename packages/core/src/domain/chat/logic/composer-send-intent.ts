/**
 * Composer 发送门闩 / 入参清洗（T-ATD* / T-CR3）。
 * 文件引用以正文 `@` 扫描、技能引用以正文 `$` 扫描为准；draft attach 恒空；
 * workplace 预览不进 payload、不可空发。
 *
 * @module domain/chat/logic/composer-send-intent
 */

import { scanAtPathAttachments } from "./scan-at-path-attachments.js";
import { scanSkillAttachments } from "./scan-skill-attachments.js";

/** 门闩只读正文扫描与显式布尔；不接收 draft attach chip。 */
type ComposerSendIntentInput = {
  text: string;
  canResumeWithoutInput: boolean;
  /** 本会话有未发送批注草稿（调用方取或后传入）。 */
  hasAnnotateDrafts?: boolean;
  /** 默认 true（测门闩时）；组件内以模型探测为准。 */
  hasModel?: boolean;
  running?: boolean;
};

type ComposerSendIntent = {
  hasSendable: boolean;
  allowResumeWithoutInput: boolean;
  /** 显式 attachments 恒空；Core 从正文扫描 `@`。 */
  attachOnly: readonly [];
  sendDisabled: boolean;
};

export function resolveComposerSendIntent(input: ComposerSendIntentInput): ComposerSendIntent {
  const content = input.text.trim();
  const scannedCount = scanAtPathAttachments(input.text).length + scanSkillAttachments(input.text).length;
  const hasSendable = content !== "" || scannedCount > 0 || input.hasAnnotateDrafts === true;
  const allowResumeWithoutInput = !hasSendable && input.canResumeWithoutInput;
  const hasModel = input.hasModel !== false;
  const running = input.running === true;
  const sendDisabled = !hasModel || (!running && !hasSendable && !input.canResumeWithoutInput);
  return {
    hasSendable,
    allowResumeWithoutInput,
    attachOnly: [],
    sendDisabled,
  };
}
