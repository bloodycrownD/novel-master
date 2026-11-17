/**
 * 进程级 Agent 运行标记（引用计数）：备份/云同步等操作须在 Agent 空闲时执行。
 * busy 由平台层 increment/decrement 独占管理；renderer hook 不得直接改计数。
 *
 * 命名与 desktop 侧 `runtime/agent-activity.ts` 的 `*DesktopAgent*` 镜像：
 * 两端各自实例化一份 tracker，创作面用 Mobile/Desktop 前缀区分。
 * `setMobileAgentActive` 是仅 mobile 导出（desktop 无 setActive 对位）。
 */
import { AgentActivityTracker } from "@novel-master/core/agent";

const agentActivity = new AgentActivityTracker();

/** 订阅 Agent 运行状态变化；返回取消订阅函数。 */
export const subscribeMobileAgentActivity = agentActivity.subscribe;

/** Agent 回合开始时递增引用计数；0→1 时通知订阅者。 */
export const incrementMobileAgentActive = agentActivity.increment;

/**
 * Agent 回合结束时递减引用计数；1→0 时通知订阅者。
 * 计数已为 0 时幂等忽略，避免 FINISHED 与 finally 双减。
 */
export const decrementMobileAgentActive = agentActivity.decrement;

/** Agent 是否正在运行（供门禁、DB 备份与云同步守卫使用）。 */
export const isMobileAgentActive = agentActivity.isActive;

/**
 * @deprecated 请改用 incrementMobileAgentActive / decrementMobileAgentActive。
 * 迁移期兼容：直接覆盖为布尔状态（置 true 时计数归 1，置 false 时归 0）。
 * 仅 mobile 导出：desktop 的计数只走 increment/decrement，没有 setActive 入口。
 */
export const setMobileAgentActive = agentActivity.setActive;
