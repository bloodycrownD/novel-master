/**
 * 折叠区骨架（web/C-2）：header 事件委托 + 展开体容器。
 * ToolGroup / AttachGroup 复用整个 section；StreamTail 与 ThinkingSection 的
 * thinking header 复用 CollapsibleHeader（title/chevron class 由 headerClass 前缀派生：
 * tool-group-header → tool-group-title / tool-group-chevron，thinking-header 同理）。
 * 约束：DOM 结构与 class 与抽离前逐属性一致（data-action 委托 key 不变）。
 */
import type {ComponentChildren} from 'preact';

export type CollapsibleHeaderProps = {
  /** header 基础 class（tool-group-header / thinking-header）。 */
  headerClass: string;
  title: string;
  /** data-action 委托动作（toggle-tool-group / toggle-attach-group / toggle-thinking）。 */
  action: string;
  /** 委托 data-* 属性名（不含 data- 前缀）与值。 */
  dataKey: string;
  dataValue: string;
  expanded: boolean;
};

export function CollapsibleHeader({
  headerClass,
  title,
  action,
  dataKey,
  dataValue,
  expanded,
}: CollapsibleHeaderProps) {
  return (
    <div
      className={headerClass}
      data-action={action}
      {...({['data-' + dataKey]: dataValue} as Record<string, string>)}
    >
      <span className={headerClass + '-title'}>{title}</span>
      <span className={headerClass + '-chevron'}>{expanded ? '▼' : '▶'}</span>
    </div>
  );
}

export type CollapsibleSectionProps = {
  title: string;
  /** data-action 委托动作（toggle-tool-group / toggle-attach-group）。 */
  action: string;
  /** 委托 data-* 属性名（不含 data- 前缀）与值。 */
  dataKey: string;
  dataValue: string;
  expanded: boolean;
  /** 外层 section 基础 class；divided 修饰由 dividedClass 追加。 */
  sectionClass: string;
  /** 分割线修饰 class（含前导空格；空串 = 无分割线）。 */
  dividedClass: string;
  children: ComponentChildren;
};

export function CollapsibleSection({
  title,
  action,
  dataKey,
  dataValue,
  expanded,
  sectionClass,
  dividedClass,
  children,
}: CollapsibleSectionProps) {
  return (
    <div
      className={sectionClass + dividedClass}
      {...({['data-' + dataKey]: dataValue} as Record<string, string>)}
    >
      <CollapsibleHeader
        headerClass="tool-group-header"
        title={title}
        action={action}
        dataKey={dataKey}
        dataValue={dataValue}
        expanded={expanded}
      />
      {expanded ? <div className="tool-group-items">{children}</div> : null}
    </div>
  );
}
