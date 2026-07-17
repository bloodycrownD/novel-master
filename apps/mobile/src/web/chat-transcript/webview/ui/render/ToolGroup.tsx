/**
 * 工具调用组：可折叠 header + 卡片列表。
 */
import { h } from 'preact';
import type { ToolCallRow } from '../../runtime/state/state';
import {
  toolCallSummary,
  toolStatusClass,
  toolStatusLabel,
} from '../../runtime/render/tool-logic';
import { vfsToolFilePath } from '../../runtime/util/vfs-tool-path';

export type ToolGroupProps = {
  tools: ToolCallRow[];
  groupKey: string;
  expanded: boolean;
  showDividerBelow?: boolean;
  groupTitle?: string;
};

function ToolGroupItem({ tool }: { tool: ToolCallRow }) {
  const filePath = vfsToolFilePath(tool.name || '', tool.input || {});
  const canOpen = filePath != null;
  const summary = toolCallSummary(tool);
  const statusClass = toolStatusClass(tool.status);
  const statusInner = toolStatusLabel(tool.status);
  return (
    <div
      className={'tool-group-item tool-card' + (canOpen ? ' tappable' : '')}
      data-action={canOpen ? 'open-tool-file' : undefined}
      data-path={canOpen ? filePath! : undefined}
    >
      <div className="tool-header">
        <span className="tool-name">{tool.name || ''}</span>
        <span className={'tool-status ' + statusClass}>{statusInner}</span>
      </div>
      {summary ? <div className="tool-summary">{summary}</div> : null}
      {canOpen ? <div className="tool-open-hint">点击查看 · 聊天工作区</div> : null}
    </div>
  );
}

export function ToolGroup({
  tools,
  groupKey,
  expanded,
  showDividerBelow,
  groupTitle,
}: ToolGroupProps) {
  if (!tools || tools.length === 0) return null;
  const chevron = expanded ? '▼' : '▶';
  const divided = expanded && showDividerBelow ? ' tool-group-divided' : '';
  const title = groupTitle || '工具调用 (' + tools.length + ')';
  return (
    <div
      className={'tool-group-section' + divided}
      data-tool-group-key={groupKey}
    >
      <div
        className="tool-group-header"
        data-action="toggle-tool-group"
        data-tool-group-key={groupKey}
      >
        <span className="tool-group-title">{title}</span>
        <span className="tool-group-chevron">{chevron}</span>
      </div>
      {expanded ? (
        <div className="tool-group-items">
          {tools.map((tool, i) => (
            <ToolGroupItem key={i} tool={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
