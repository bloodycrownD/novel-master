import {
  countFilesInDir,
  isDirectChild,
  mapVfsFilePath,
  mapWorktreeRow,
  type MappedVfsRow,
} from '../src/components/vfs/vfs-row-mapper';
import type {WorktreeListRow} from '@novel-master/core';

describe('vfs-row-mapper', () => {
  const dirRow: WorktreeListRow = {
    kind: 'dir',
    path: '/template/shared',
    ruleState: '规则·开',
    inclusionMode: '',
    displayState: '',
  };

  const fileRowAuto: WorktreeListRow = {
    kind: 'file',
    path: '/template/readme.md',
    ruleState: '',
    inclusionMode: '自动',
    displayState: '全内容',
  };

  const fileRowShow: WorktreeListRow = {
    kind: 'file',
    path: '/template/visible.md',
    ruleState: '',
    inclusionMode: '展示',
    displayState: '全内容',
  };

  const fileRowHide: WorktreeListRow = {
    kind: 'file',
    path: '/template/hidden.md',
    ruleState: '',
    inclusionMode: '隐藏',
    displayState: '不展示',
  };

  it('maps directory subtitle with file count', () => {
    const mapped = mapWorktreeRow(dirRow, 3);
    expect(mapped.subtitle).toBe('规则·开 | 3个文件');
    expect(mapped.badge).toBeNull();
    expect(mapped.ruleEnabled).toBe(true);
  });

  it('maps directory rule off without count suffix when zero files', () => {
    const off: WorktreeListRow = {...dirRow, ruleState: '规则·关'};
    const mapped = mapWorktreeRow(off, 0);
    expect(mapped.subtitle).toBe('规则·关');
    expect(mapped.ruleEnabled).toBe(false);
  });

  it('maps auto file badge as follow tone with display label', () => {
    const mapped = mapWorktreeRow(fileRowAuto);
    expect(mapped.subtitle).toBe('自动·全内容');
    expect(mapped.badge).toEqual({label: '全内容', tone: 'follow'});
  });

  it('maps show file badge as in tone', () => {
    const mapped = mapWorktreeRow(fileRowShow);
    expect(mapped.badge).toEqual({label: '展示', tone: 'in'});
  });

  it('maps hide file badge as muted tone', () => {
    const mapped = mapWorktreeRow(fileRowHide);
    expect(mapped.badge).toEqual({label: '隐藏', tone: 'muted'});
  });

  it('counts direct child files only', () => {
    const rows: WorktreeListRow[] = [
      dirRow,
      fileRowAuto,
      {
        kind: 'file',
        path: '/template/shared/nested.md',
        ruleState: '',
        inclusionMode: '自动',
        displayState: '文件名',
      },
    ];
    expect(countFilesInDir(rows, '/template')).toBe(1);
    expect(countFilesInDir(rows, '/template/shared')).toBe(1);
  });

  it('detects direct children', () => {
    expect(isDirectChild('/template', '/template/a.md')).toBe(true);
    expect(isDirectChild('/template', '/template/sub/a.md')).toBe(false);
  });

  it('fallback vfs file path mapping', () => {
    const mapped: MappedVfsRow = mapVfsFilePath('/template/new.md');
    expect(mapped.name).toBe('new.md');
    expect(mapped.subtitle).toBe('自动·全内容');
  });
});
