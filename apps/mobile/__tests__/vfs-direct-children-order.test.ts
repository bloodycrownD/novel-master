import {orderedDirectChildPaths} from '../src/components/vfs/vfs-direct-children-order';
import type {WorktreeDirRule, WorktreeListRow} from '@novel-master/core';
import {DEFAULT_WORKTREE_DIR_RULE} from '@novel-master/core';

describe('orderedDirectChildPaths', () => {
  const parent = '/p';
  const rows: WorktreeListRow[] = [
    {
      kind: 'dir',
      path: '/p',
      ruleState: '规则·开',
      inclusionMode: '',
      displayState: '',
    },
    {
      kind: 'dir',
      path: '/p/a',
      ruleState: '规则·关',
      inclusionMode: '',
      displayState: '',
    },
    {
      kind: 'file',
      path: '/p/a/f',
      ruleState: '',
      inclusionMode: '跟随',
      displayState: '全内容',
    },
    {
      kind: 'file',
      path: '/p/b.md',
      ruleState: '',
      inclusionMode: '跟随',
      displayState: '全内容',
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
