import {
  countFilesInDir,
  isDirectChild,
  mapVfsFilePath,
  mapVfsListEntry,
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
    inclusionMode: '继承',
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

  it('maps directory badge and file count subtitle', () => {
    const mapped = mapWorktreeRow(dirRow, 3);
    expect(mapped.subtitle).toBe('3个文件');
    expect(mapped.badge).toEqual({label: '开启', tone: 'in'});
    expect(mapped.ruleEnabled).toBe(true);
  });

  it('maps directory rule off badge without count subtitle when zero files', () => {
    const off: WorktreeListRow = {...dirRow, ruleState: '规则·关'};
    const mapped = mapWorktreeRow(off, 0);
    expect(mapped.subtitle).toBe('');
    expect(mapped.badge).toEqual({label: '关闭', tone: 'muted'});
    expect(mapped.ruleEnabled).toBe(false);
  });

  it('maps inherit file badge as follow tone without expanding display', () => {
    const mapped = mapWorktreeRow(fileRowAuto);
    expect(mapped.subtitle).toBe('继承·全内容');
    expect(mapped.badge).toEqual({label: '继承', tone: 'follow'});
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
        inclusionMode: '继承',
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
    expect(mapped.subtitle).toBe('继承·全内容');
  });

  it('maps vfs list directory entry', () => {
    const mapped = mapVfsListEntry({path: '/drafts', kind: 'directory'});
    expect(mapped.kind).toBe('dir');
    expect(mapped.name).toBe('drafts');
    expect(mapped.subtitle).toBe('');
  });
});
