/**
 * 将 Composer 状态条投影推送给 renderer（整表替换 workplace|user_ops）。
 * 空列表也发送，以便清掉上一条状态 chip。
 */
import { IPC_CHANNELS, type ComposerAttachmentsSuggestPayload } from "../../../shared/ipc-types.js";
import { EventForwarder } from "./event-forwarder.js";

/** 与 workspaceMutated 共用同一窗口解析器；notify 整表替换 Composer 状态条附件。 */
export const ComposerAttachmentsSuggestForwarder = EventForwarder.create<ComposerAttachmentsSuggestPayload>(IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST);
