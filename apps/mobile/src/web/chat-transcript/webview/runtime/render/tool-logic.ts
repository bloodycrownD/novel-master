import {summarizeToolInput} from '@novel-master/core/chat';
import type {ToolCallRow} from '../state/state';

/**
 * 工具调用摘要与状态标签（非 JSX）。
 * 工具组 UI 由 ui/render/ToolGroup 渲染；本文件仅供其复用的纯逻辑。
 */

// 摘要单源已收敛到 core（`domain/chat/logic/tool-summary.ts`）。
// ⚠️ 这里必须写成「import + export」两步，**不能**写成纯 re-export
// `export { summarizeToolInput } from '@novel-master/core/chat';`——
// 纯 re-export 不把该符号引入本模块作用域，而下方 `toolCallSummary` 正在本地调用它。
// 该 `export` 的唯一作用是保住本地引用（`ToolGroup.tsx` 并不 import 它），不是对外新增 API。
export {summarizeToolInput};

export function toolCallSummary(row: ToolCallRow): string {
  if (row.status === 'error' && row.summary) {
    return row.summary;
  }
  const fromInput = summarizeToolInput(row.name || '', row.input || {});
  if (fromInput) return fromInput;
  if (row.resultContent) {
    const t = String(row.resultContent).trim();
    return t.length > 120 ? t.slice(0, 117) + '…' : t;
  }
  return '';
}

export function toolStatusLabel(status: string | undefined): string {
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'pending') return '执行中';
  if (status === 'interrupted') return '已中断';
  return '';
}

/** 工具状态对应 CSS 修饰类名。 */
export function toolStatusClass(status: string | undefined): string {
  if (status === 'error') return 'error';
  if (status === 'pending') return 'pending';
  if (status === 'interrupted') return 'interrupted';
  return 'success';
}
