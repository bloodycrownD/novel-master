/**
 * P0-3：renderRows 门面 + flagsEqual + 附件标签辅助。
 * 行列表结构主路径在 ui/render；由 main 注册 Preact 实现。
 * 流式壳已迁 ui/stream；不再保留 renderAssistantBubbleInner 拼串。
 */
import { formatStatusChipLabelFromAttachment } from '@novel-master/core/chat';
import type { TranscriptFlags } from '../state/state';

export type RenderRowsView = () => void;

let _renderRowsView: RenderRowsView | null = null;

/** 由 main 注册 Preact（或其它）行列表刷新实现。 */
export function registerRenderRows(fn: RenderRowsView): void {
  _renderRowsView = fn;
}

/** 调用已注册实现；未注册时返回 false。 */
export function invokeRegisteredRenderRows(): boolean {
  if (!_renderRowsView) return false;
  _renderRowsView();
  return true;
}

export function flagsEqual(a: TranscriptFlags, b: TranscriptFlags): boolean {
  return a.richText === b.richText && a.menuDisabled === b.menuDisabled;
}

/**
 * 行列表全量刷新门面：只转发已注册实现（禁止在此拼串 / preact.render）。
 */
export function renderRows(): void {
  invokeRegisteredRenderRows();
}

/** 附件芯片主标签（明文；无 emoji /「规则 ·」）。 */
export function attachmentChipLabel(a: {
  source?: string;
  type?: string;
  name?: string;
  path?: string;
  action?: string;
  content?: string | null;
}): string {
  if (a.source === 'attach') {
    const path = a.path || a.name || '';
    return path.startsWith('@') ? path : `@${path}`;
  }
  return formatStatusChipLabelFromAttachment({
    source: (a.source as 'workplace' | 'attach' | 'user_ops') ?? 'user_ops',
    name: a.name ?? '',
    path: a.path,
    action: a.action as
      | 'delete'
      | 'write'
      | 'edit'
      | 'mkdir'
      | 'rename'
      | 'workplaceChange'
      | 'userAttach'
      | 'annotate'
      | undefined,
    content: a.content ?? null,
  });
}

/** 附件来源副标签（明文）。 */
export function attachmentSourceLabel(a: {
  source?: string;
  type?: string;
}): string {
  if (a.source === 'workplace') {
    return '工作区';
  }
  if (a.source === 'user_ops') {
    return '';
  }
  return a.type === 'dir' ? '目录' : '文件';
}
