/**
 * 将 main 进程 agentActive refcount 变化推送给 renderer（工具卡等 UI 绑定 agentActive）。
 */
import { IPC_CHANNELS, type AgentActivityPayload } from "../../../shared/ipc-types.js";
import { agentActivity } from "../runtime/agent-activity.js";
import { createEventForwarder } from "./event-forwarder.js";

/** 注册 renderer webContents 解析器（与 agent stream 转发共用同一窗口策略）。 */
export const AgentActivityForwarder = createEventForwarder<AgentActivityPayload>(IPC_CHANNELS.AGENT_ACTIVITY, {
  /** 订阅 refcount 变化并转发至 renderer；cleanup 供 app quit / rebootstrap 使用。 */
  subscribe: (emit) => agentActivity.subscribe((active: boolean) => emit({ active })),
});
