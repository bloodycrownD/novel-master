/**
 * 将 main 进程 agentActive refcount 变化推送给 renderer（工具卡等 UI 绑定 agentActive）。
 */
import type { WebContents } from "electron";
import {
  IPC_CHANNELS,
  type AgentActivityPayload,
} from "../../../shared/ipc-types.js";
import { subscribeDesktopAgentActivity } from "../runtime/agent-activity.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;
let detachSubscription: (() => void) | undefined;

/** 注册 renderer webContents 解析器（与 agent stream 转发共用同一窗口策略）。 */
export function setAgentActivityForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

function notifyRenderer(active: boolean): void {
  const payload: AgentActivityPayload = { active };
  getTargetWebContents?.()?.send(IPC_CHANNELS.AGENT_ACTIVITY, payload);
}

/**
 * 订阅 refcount 变化并转发至 renderer。
 * 返回 cleanup，供 app quit / rebootstrap 使用。
 */
export function attachAgentActivityForwarder(): () => void {
  detachAgentActivityForwarder();
  detachSubscription = subscribeDesktopAgentActivity(notifyRenderer);
  return detachAgentActivityForwarder;
}

/** 解除 agentActive IPC 转发订阅。 */
export function detachAgentActivityForwarder(): void {
  detachSubscription?.();
  detachSubscription = undefined;
}
