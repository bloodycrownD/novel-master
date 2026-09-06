/** API Key 连接状态用户可见文案（wire 仍为 set / not set）。 */
export const API_KEY_STATUS_LABELS = {
  set: "已连接",
  notSet: "未连接",
} as const;

/** Agent 列表与元信息文案。 */
export const AGENT_LIST_LABELS = {
  needsRepair: "需修复",
  maxSteps: (n: number) => `最大步数 ${n}`,
} as const;
