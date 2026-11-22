import { coreT } from "../logic/core-i18n.js";

/** API Key 连接状态用户可见文案（wire 仍为 set / not set）。 */
export const API_KEY_STATUS_LABELS = {
    set: coreT({key: "ui.provider.connected"}),
    notSet: coreT({key: "ui.provider.not_connected"}),
} as const;

/** Agent 列表与元信息文案。 */
export const AGENT_LIST_LABELS = {
    needsRepair: coreT({key: "ui.provider.needs_fix"}),
    maxSteps: (n: number) => coreT({key: "ui.agent.max_steps_value", params: {n}}),
} as const;
