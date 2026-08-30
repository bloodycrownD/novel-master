/**
 * code-editor 载荷与主题类型（runtime 模型）。
 */

export const BRIDGE_V = 1;

// HostTheme 超集统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme} from '@web/shared/host-theme';

export type SetDocumentPayload = {
  text?: string;
  path?: string;
};
