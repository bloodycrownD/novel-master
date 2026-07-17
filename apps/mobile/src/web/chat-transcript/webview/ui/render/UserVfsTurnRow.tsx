/**
 * 用户 VFS 回合行：仅工具组气泡。
 */
import type { UserVfsTurnRow as UserVfsTurnRowModel } from '../../runtime/state/state';
import { state } from '../../runtime/state/state';
import { ToolGroup } from './ToolGroup';

export type UserVfsTurnRowProps = {
  row: UserVfsTurnRowModel;
};

export function UserVfsTurnRow({ row }: UserVfsTurnRowProps) {
  if (!row.tools || row.tools.length === 0) return null;
  const hidden = row.hidden ? ' hidden' : '';
  const toolGroupKey = 'vfs-turn:' + row.id;
  const toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
  return (
    <div
      className={'row message user vfs-turn-row' + hidden}
      data-id={row.id}
    >
      <div className="bubble bubble--fill-width vfs-turn-bubble">
        <ToolGroup
          tools={row.tools}
          groupKey={toolGroupKey}
          expanded={toolGroupExpanded}
          showDividerBelow={false}
          groupTitle={'用户操作 (' + row.tools.length + ')'}
        />
      </div>
    </div>
  );
}
