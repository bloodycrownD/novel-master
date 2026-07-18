/**
 * 将 Composer 状态条投影推送给 renderer（整表替换 workplace|user_ops）。
 * 空列表也发送，以便清掉上一条状态 chip。
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

/** 通知 renderer 整表替换 Composer 状态条附件。 */
export function notifyComposerAttachmentsSuggestToRenderer(
  payload: ComposerAttachmentsSuggestPayload,
): void {
  getTargetWebContents?.()?.send(
    IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    payload,
  );
}
