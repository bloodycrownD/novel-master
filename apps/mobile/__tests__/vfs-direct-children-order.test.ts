import {orderedDirectChildPaths} from '../src/components/vfs/vfs-direct-children-order';
import { type WorktreeDirRule, type WorktreeListRow } from "@novel-master/core/worktree";
import { DEFAULT_WORKTREE_DIR_RULE } from "@novel-master/core/worktree";

describe('orderedDirectChildPaths', () => {
  const parent = '/p';
  const rows: WorktreeListRow[] = [
    {
      kind: 'dir',
      path: '/p',
      ruleState: 'rule_on',
    },
    {
      kind: 'dir',
      path: '/p/a',
      ruleState: 'rule_off',
    },
    {
      kind: 'file',
      path: '/p/a/f',
      inclusionMode: 'auto',
      displayState: 'full',
    },
    {
      kind: 'file',
      path: '/p/b.md',
      inclusionMode: 'auto',
      displayState: 'full',
    },
  ];

  it('extracts direct children in DFS row order (dirs before sibling files)', () => {
    const order = orderedDirectChildPaths({
      parentPath: parent,
      rows,
      extraPaths: ['/p/a', '/p/b.md'],
      dirRule: null,
    });
    expect(order).toEqual(['/p/a', '/p/b.md']);
  });

  it('appends vfs-only orphans after row order, dirs before files', () => {
    const order = orderedDirectChildPaths({
      parentPath: parent,
      rows,
      extraPaths: ['/p/a', '/p/b.md', '/p/z-only.md', '/p/y-dir'],
      dirRule: null,
      kindByPath: new Map([
        ['/p/z-only.md', 'file'],
        ['/p/y-dir', 'dir'],
      ]),
    });
    expect(order).toEqual(['/p/a', '/p/b.md', '/p/y-dir', '/p/z-only.md']);
  });

  it('reverses orphan path order when sortOrder is desc', () => {
    const ascRule: WorktreeDirRule = {
      ...DEFAULT_WORKTREE_DIR_RULE,
      sortOrder: 'asc',
    };
    const descRule: WorktreeDirRule = {
      ...DEFAULT_WORKTREE_DIR_RULE,
      sortOrder: 'desc',
    };
    const extraPaths = ['/p/orphan-a', '/p/orphan-b'];
    const kindByPath = new Map([
      ['/p/orphan-a', 'file'] as const,
      ['/p/orphan-b', 'file'] as const,
    ]);

    const asc = orderedDirectChildPaths({
      parentPath: parent,
      rows: [],
      extraPaths,
      dirRule: ascRule,
      kindByPath,
    });
    const desc = orderedDirectChildPaths({
      parentPath: parent,
      rows: [],
      extraPaths,
      dirRule: descRule,
      kindByPath,
    });

    expect(asc).toEqual(['/p/orphan-a', '/p/orphan-b']);
    expect(desc).toEqual(['/p/orphan-b', '/p/orphan-a']);
  });
});
