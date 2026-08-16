/** API Key 连接状态用户可见文案（wire 仍为 set / not set）。 */
export const API_KEY_STATUS_LABELS = {
  set: "已连接",
  notSet: "未连接",
} as const;

/** 工作区「文件版本校验」开关文案。 */
export const SESSION_FS_LABELS = {
  title: "文件版本校验",
  enabledHint: "已开启版本校验",
  disabledHint: "已关闭版本校验",
} as const;

/** 正则规则编辑器深度与通道文案。 */
export const REGEX_UI_LABELS = {
  startDepth: "开始深度",
  endDepth: "结束深度",
  promptChannel: "提示词通道",
  displayChannel: "展示通道",
} as const;

/** Agent 列表与元信息文案。 */
export const AGENT_LIST_LABELS = {
  needsRepair: "需修复",
  maxSteps: (n: number) => `最大步数 ${n}`,
} as const;
