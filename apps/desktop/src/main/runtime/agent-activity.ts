/**
 * 进程级 Agent 运行引用计数：备份/云同步等操作须在 Agent 空闲时执行。
 * busy 由 main IPC 层 increment/decrement 独占；renderer 通过 IPC 订阅状态。
 */
import { AgentActivityTracker } from "@novel-master/core/agent";

export const agentActivity = new AgentActivityTracker();
