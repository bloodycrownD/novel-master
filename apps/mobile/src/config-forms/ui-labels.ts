import { coreT } from "../i18n/core";

/** API Key 连接状态用户可见文案（wire 仍为 set / not set）。 */
export const API_KEY_STATUS_LABELS = {
  set: coreT({ key: "ui.provider.connected" }),
  notSet: coreT({ key: "ui.provider.not_connected" }),
} as const;
