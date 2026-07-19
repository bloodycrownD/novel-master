/**
 * 将「用户消息已 append」推送给 renderer（清 annotate；勿复用 RUN_*）。
 * 仿 {@link notifyComposerAttachmentsSuggestToRenderer}。
 */
import type { WebContents } from "electron";
import {
  IPC_CHANNELS,
  type AgentUserMessageAppendedPayload,
} from "../../../shared/ipc-types.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;

/** 与 suggest / workspaceMutated 共用同一窗口解析器。 */
export function setUserMessageAppendedForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

/** 通知 renderer：该会话用户消息已 append。 */
export function notifyUserMessageAppendedToRenderer(
  payload: AgentUserMessageAppendedPayload,
): void {
  getTargetWebContents?.()?.send(
    IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED,
    payload,
  );
}
