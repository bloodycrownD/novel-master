/**
 * 将规则差集 workplace 附件建议推送给 renderer（独立于 workspaceMutated）。
 */
import type { WebContents } from "electron";
import {
  IPC_CHANNELS,
  type ComposerAttachmentsSuggestPayload,
} from "../../../shared/ipc-types.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;

/** 与 workspaceMutated 共用同一窗口解析器。 */
export function setComposerAttachmentsSuggestForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

/** 通知 renderer 追加 Composer workplace 附件草稿。 */
export function notifyComposerAttachmentsSuggestToRenderer(
  payload: ComposerAttachmentsSuggestPayload,
): void {
  if (payload.attachments.length === 0) {
    return;
  }
  getTargetWebContents?.()?.send(
    IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    payload,
  );
}
