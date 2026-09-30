/**
 * code-editor 载荷与主题类型（runtime 模型）。
 */

export const BRIDGE_V = 1;

// HostTheme 超集统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme} from '@web/shared/host-theme';

export type SetDocumentPayload = {
  text?: string;
  path?: string;
  /**
   * 外部受控选区（token 插入等程序化写入的光标一次落位）：省略则保持编辑器
   * 自身映射/默认位置。坐标为 plain 文本偏移，与 change 上报的 text 同一坐标系。
   */
  selectionStart?: number;
  selectionEnd?: number;
};
