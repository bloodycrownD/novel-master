/**
 * code-editor 载荷与主题类型（runtime 模型）。
 */

export const BRIDGE_V = 1;

export type HostTheme = {
  background?: string;
  text?: string;
  textSecondary?: string;
  primary?: string;
  surface?: string;
  borderLight?: string;
};

export type SetDocumentPayload = {
  text?: string;
  path?: string;
};
