/**
 * 将「用户消息已 append」推送给 renderer（清 annotate；勿复用 RUN_*）。
 * 仿 {@link ComposerAttachmentsSuggestForwarder}。
 */
import { IPC_CHANNELS, type AgentUserMessageAppendedPayload } from "../../../shared/ipc-types.js";
import { createEventForwarder } from "./event-forwarder.js";

/** 与 suggest / workspaceMutated 共用同一窗口解析器；notify 通知该会话用户消息已 append。 */
export const UserMessageAppendedForwarder = createEventForwarder<AgentUserMessageAppendedPayload>(IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED);
