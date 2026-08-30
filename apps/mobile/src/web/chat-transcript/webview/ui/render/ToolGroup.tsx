/**
 * 工具调用组：可折叠 header + 卡片列表。
 */
import type {ToolCallRow} from '../../runtime/state/state';
import {
  toolCallSummary,
  toolStatusClass,
  toolStatusLabel,
} from '../../runtime/render/tool-logic';
import {vfsToolFilePath} from '../../runtime/util/vfs-tool-path';
import {skillToolRef} from '../../runtime/util/skill-tool-ref';
import {CollapsibleSection} from './CollapsibleSection';

export type ToolGroupProps = {
  tools: ToolCallRow[];
  groupKey: string;
  expanded: boolean;
  showDividerBelow?: boolean;
  groupTitle?: string;
};

function ToolGroupItem({tool}: {tool: ToolCallRow}) {
  const filePath = vfsToolFilePath(tool.name || '', tool.input || {});
  // Bug1 加固：write/edit 卡片点击跳不了时，这里是最可能的断点（input 字段名不标准）。
  // 当工具名属于「可打开文件」集合但 filePath 解析为 null 时，打 warn 打印 input 的 keys，
  // 方便真机复现时从 logcat 定位实际传的字段名（path / file_path / filename / ...）。
  // webview bundle 跑在 file:// 浏览器环境无 process.env，这里不加 dev 守卫——
  // warn 本身就是诊断手段，生产里只在异常路径触发，不会常规判刷。
  if (filePath == null && tool.name) {
    const normalized = tool.name.startsWith('vfs.')
      ? tool.name.slice(4)
      : tool.name;
    if (
      normalized === 'write' ||
      normalized === 'edit' ||
      normalized === 'read'
    ) {
      const inputKeys = tool.input ? Object.keys(tool.input) : [];
      console.warn(
        '[ToolGroup] write/edit/read 卡片无法解析路径',
        'tool=',
        tool.name,
        'inputKeys=',
        inputKeys,
        'input=',
        tool.input,
      );
    }
  }
  // 子会话优先；其次 skill 三元组；最后回退到文件路径打开。
  const subagentSessionId = tool.subagentSessionId;
  const hasSubagent = subagentSessionId != null;
  // projectId 缺省时由宿主按会话上下文补齐（webview 无会话上下文）
  const skillRef = skillToolRef(tool);
  const hasSkill = !hasSubagent && skillRef != null;
  const canOpen = filePath != null || hasSubagent || hasSkill;
  const summary = toolCallSummary(tool);
  const statusClass = toolStatusClass(tool.status);
  const statusInner = toolStatusLabel(tool.status);
  const openHint = hasSubagent
    ? '点击查看 · 子会话'
    : hasSkill
    ? '点击查看 · 技能'
    : '点击查看 · 聊天工作区';
  return (
    <div
      className={'tool-group-item tool-card' + (canOpen ? ' tappable' : '')}
      data-action={
        hasSubagent
          ? 'open-subagent-session'
          : hasSkill
          ? 'open-skill'
          : canOpen
          ? 'open-tool-file'
          : undefined
      }
      data-session-id={hasSubagent ? subagentSessionId : undefined}
      data-domain={hasSkill ? skillRef!.domain : undefined}
      data-project-id={hasSkill ? skillRef!.projectId ?? undefined : undefined}
      data-name={hasSkill ? skillRef!.name : undefined}
      data-path={!hasSubagent && !hasSkill && canOpen ? filePath! : undefined}
    >
      <div className="tool-header">
        <span className="tool-name">{tool.name || ''}</span>
        <span className={'tool-status ' + statusClass}>{statusInner}</span>
      </div>
      {summary ? <div className="tool-summary">{summary}</div> : null}
      {canOpen ? <div className="tool-open-hint">{openHint}</div> : null}
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
  return (
    <CollapsibleSection
      title={groupTitle || '工具调用 (' + tools.length + ')'}
      action="toggle-tool-group"
      dataKey="tool-group-key"
      dataValue={groupKey}
      expanded={expanded}
      sectionClass="tool-group-section"
      dividedClass={expanded && showDividerBelow ? ' tool-group-divided' : ''}
    >
      {tools.map((tool, i) => (
        <ToolGroupItem key={i} tool={tool} />
      ))}
    </CollapsibleSection>
  );
}
