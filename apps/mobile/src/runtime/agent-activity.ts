/**
 * 进程级 Agent 运行标记（引用计数）：备份/云同步等操作须在 Agent 空闲时执行。
 * busy 由平台层 increment/decrement 独占管理；renderer hook 不得直接改计数。
 *
 * 与 desktop 侧 `runtime/agent-activity.ts` 同形：两端各自实例化一份 tracker。
 * `setActive` 仅 mobile 消费（测试与迁移期兼容置位），desktop 只走
 * increment/decrement。
 */
import { AgentActivityTracker } from "@novel-master/core/agent";

export const agentActivity = new AgentActivityTracker();
