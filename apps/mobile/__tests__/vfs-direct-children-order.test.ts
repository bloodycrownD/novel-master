import {orderedDirectChildPaths} from '@/components/vfs/vfs-direct-children-order';
import type {CompiledSmartSortRule} from '@novel-master/core/smart-sort-rule';
import {
  type WorkplaceDirRule,
  type WorkplaceListRow,
} from '@novel-master/core/workplace';
import {DEFAULT_WORKPLACE_DIR_RULE} from '@novel-master/core/workplace';

describe('orderedDirectChildPaths', () => {
  const parent = '/p';
  const rows: WorkplaceListRow[] = [
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
    const ascRule: WorkplaceDirRule = {
      ...DEFAULT_WORKPLACE_DIR_RULE,
      sortOrder: 'asc',
    };
    const descRule: WorkplaceDirRule = {
      ...DEFAULT_WORKPLACE_DIR_RULE,
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

  const smartDirRule: WorkplaceDirRule = {
    ...DEFAULT_WORKPLACE_DIR_RULE,
    sortField: 'smart',
  };
  const zhChapterRule: CompiledSmartSortRule = {
    ruleId: 'builtin-zh-chapter',
    name: '中文序号章节',
    regex: new RegExp(
      '第([0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12})(?:章|节|卷|回|集|部|篇)',
    ),
  };

  it('passes smart rules through to file orphan sort (ordinals before misses)', () => {
    const order = orderedDirectChildPaths({
      parentPath: parent,
      rows,
      extraPaths: [
        '/p/a',
        '/p/b.md',
        '/p/第三章.txt',
        '/p/公告.txt',
        '/p/第二章.txt',
      ],
      dirRule: smartDirRule,
      kindByPath: new Map([
        ['/p/第三章.txt', 'file'],
        ['/p/公告.txt', 'file'],
        ['/p/第二章.txt', 'file'],
      ]),
      smartRules: [zhChapterRule],
    });
    // 命中序号按数值序在前（二=2 < 三=3）；未命中沉底。若未透传规则，
    // 自然排序（码位序 公516C < 第7B2C、三4E09 < 二4E8C）会得到
    // [公告, 第三章, 第二章]，与此断言区分。
    expect(order).toEqual([
      '/p/a',
      '/p/b.md',
      '/p/第二章.txt',
      '/p/第三章.txt',
      '/p/公告.txt',
    ]);
  });

  it('passes smart rules through to directory orphan sort', () => {
    const order = orderedDirectChildPaths({
      parentPath: parent,
      rows: [],
      extraPaths: ['/p/第三卷', '/p/第十卷', '/p/第二卷'],
      dirRule: smartDirRule,
      kindByPath: new Map([
        ['/p/第三卷', 'dir'],
        ['/p/第十卷', 'dir'],
        ['/p/第二卷', 'dir'],
      ]),
      smartRules: [zhChapterRule],
    });
    expect(order).toEqual(['/p/第二卷', '/p/第三卷', '/p/第十卷']);
  });

  it('degrades smart sort to natural order when no rules are provided', () => {
    const order = orderedDirectChildPaths({
      parentPath: parent,
      rows: [],
      extraPaths: ['/p/公告.txt', '/p/第三章.txt', '/p/第二章.txt'],
      dirRule: smartDirRule,
      kindByPath: new Map([
        ['/p/公告.txt', 'file'],
        ['/p/第三章.txt', 'file'],
        ['/p/第二章.txt', 'file'],
      ]),
    });
    // 无规则：序号无法提取，退化自然排序（码位序 公516C < 第7B2C、
    // 三4E09 < 二4E8C），与 smart 透传用例的输出互斥，锁住退化分支。
    expect(order).toEqual(['/p/公告.txt', '/p/第三章.txt', '/p/第二章.txt']);
  });
});
