import type { ToolCallRow } from '../state/state';

/**
 * 工具调用摘要与状态标签（非 JSX）。
 * 工具组 UI 由 ui/render/ToolGroup 渲染；本文件仅供其复用的纯逻辑。
 */

export function summarizeToolInput(
  _name: string,
  input: Record<string, unknown> | null | undefined,
): string {
  const path = input && (input.path || input.dir || input.from);
  if (typeof path === 'string') return path;
  const keys = input ? Object.keys(input) : [];
  if (keys.length === 0) return '';
  try {
    const raw = JSON.stringify(input);
    return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
  } catch {
    return keys.join(', ');
  }
}

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
