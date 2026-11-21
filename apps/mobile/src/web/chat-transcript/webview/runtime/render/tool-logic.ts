import type {ToolCallRow} from '../state/state';

/**
 * 工具调用摘要与状态标签（非 JSX）。
 * 工具组 UI 由 ui/render/ToolGroup 渲染；本文件仅供其复用的纯逻辑。
 * `ToolSummary.callSummary` 单源在 core（RN 同用），这里只保留 webview 的入口名。
 */
export {ToolSummary} from '@novel-master/core/domain/chat/presentation/tool-summary.js';

export const ToolLogic = {
  /**
   * 解析工具卡片「结果阅读」的可读正文：resultContent 非空（trim 口径）
   * 用之，否则回落 summary（fs 空目录 / glob 0 paths 的 content 是空串、
   * 信息全在 summary「0 entries」里）；两者皆空返回 undefined。
   *
   * **单源**：ToolGroup 的可点判定与 rows-click 的上抛正文都走这里——
   * 两处口径分叉会出现「渲染判可点、点击上抛空白串」（ucu P0 同族）。
   */
  readableResult: (tool: ToolCallRow): string | undefined => {
    const pickReadable = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
    return pickReadable(tool.resultContent) ?? pickReadable(tool.summary);
  },

  // nm-style: keep-public — 状态→key 阶梯与 statusClass 成对供 ToolGroup 单点调用
  // （R6 波 4a 改为查 labels ui map，文案单源在 core catalog），内联会在渲染组件里复制状态阶梯。
  /** 状态 → `ui.transcript.tool_status.*` 文案；未知状态回空串（原语义）。 */
  statusLabel: (status: string | undefined, ui: Readonly<Record<string, string>>): string => {
    const key = status === 'success' ? 'ui.transcript.tool_status.success'
      : status === 'error' ? 'ui.transcript.tool_status.error'
      : status === 'pending' ? 'ui.transcript.tool_status.pending'
      : status === 'interrupted' ? 'ui.transcript.tool_status.interrupted'
      : '';
    return key === '' ? '' : ui[key] ?? '';
  },

  /** 工具状态对应 CSS 修饰类名。 */
  // nm-style: keep-public — 与 statusLabel 同一状态阶梯的类名映射，单点消费方在 ToolGroup（本片禁改）。
  statusClass: (status: string | undefined): string => {
    if (status === 'error') return 'error';
    if (status === 'pending') return 'pending';
    if (status === 'interrupted') return 'interrupted';
    return 'success';
  },
} as const;
