/**
 * 将 prompt 占用读数的第二相（后台精确计数结果）推送给 renderer。
 *
 * 与 {@link WorkspaceMutatedForwarder} 同范式：main 是唯一的取数方，
 * renderer 只订阅。为什么必须有这条通道：读口两阶段（首帧估算即回 + 后台
 * 精确计数）的第二相原先只暖 L1、等 renderer 下次自己来问——手动压缩/置位/
 * 回滚这类一次性动作之后没有「下一次」，chip 就停在估算档 `gpt ≈`（用户实报
 * 「手动压缩后分词器变成 gpt 兜底」）。推送的 stats 恒为精确档，见
 * {@link PromptChatTokenUpdatedPayload}。
 */
import { IPC_CHANNELS, type PromptChatTokenUpdatedPayload } from "../../../shared/ipc-types.js";
import { createEventForwarder } from "./event-forwarder.js";

/** 与 workspaceMutated / composer 建议共用同一窗口解析器；notify 推送某会话的精确读数。 */
export const PromptChatTokenUpdatedForwarder = createEventForwarder<PromptChatTokenUpdatedPayload>(IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED);
