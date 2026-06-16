import {
  countFilesInDir,
  isDirectChild,
  mapVfsFilePath,
  mapVfsListEntry,
  mapWorktreeRow,
  patchDirRuleRow,
  remapDirectChildRows,
  type MappedVfsRow,
} from '../src/components/vfs/vfs-row-mapper';
import { type WorktreeListRow } from "@novel-master/core/worktree";

describe('vfs-row-mapper', () => {
  const dirRow: WorktreeListRow = {
    kind: 'dir',
    path: '/shared',
    ruleState: '规则·开',
    inclusionMode: '',
    displayState: '',
  };

  const fileRowAuto: WorktreeListRow = {
    kind: 'file',
    path: '/readme.md',
    ruleState: '',
    inclusionMode: '跟随',
    displayState: '全内容',
  };

  const fileRowShow: WorktreeListRow = {
    kind: 'file',
    path: '/visible.md',
    ruleState: '',
    inclusionMode: '展示',
    displayState: '全内容',
  };

  const fileRowHide: WorktreeListRow = {
    kind: 'file',
    path: '/hidden.md',
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

  it('remaps direct child file rows after inclusion change', () => {
    const fileInShared: WorktreeListRow = {
      kind: 'file',
      path: '/shared/readme.md',
      ruleState: '',
      inclusionMode: '跟随',
      displayState: '全内容',
    };
    const siblingAuto: WorktreeListRow = {
      kind: 'file',
      path: '/shared/other.md',
      ruleState: '',
      inclusionMode: '跟随',
      displayState: '文件名',
    };
    const visible: MappedVfsRow[] = [
      mapWorktreeRow(fileInShared),
      mapWorktreeRow(siblingAuto),
      mapWorktreeRow(fileRowAuto),
    ];
    const updatedMeta: WorktreeListRow[] = [
      {...fileInShared, inclusionMode: '展示', displayState: '全内容'},
      {...siblingAuto, displayState: '全内容'},
    ];
    const remapped = remapDirectChildRows(visible, '/shared', updatedMeta);
    expect(remapped[0].badge).toEqual({label: '展示', tone: 'in'});
    expect(remapped[0].subtitle).toBe('展示·全内容');
    expect(remapped[1].subtitle).toBe('跟随·全内容');
    expect(remapped[2]).toBe(visible[2]);
  });

  it('patches directory rule badge without remapping the whole row', () => {
    const mapped = mapWorktreeRow(dirRow, 2);
    const patched = patchDirRuleRow(mapped, false);
    expect(patched.subtitle).toBe('2个文件');
    expect(patched.badge).toEqual({label: '关闭', tone: 'muted'});
    expect(patched.ruleEnabled).toBe(false);
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
    expect(mapped.subtitle).toBe('跟随·全内容');
    expect(mapped.badge).toEqual({label: '跟随', tone: 'follow'});
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
        path: '/shared/nested.md',
        ruleState: '',
        inclusionMode: '跟随',
        displayState: '文件名',
      },
    ];
    expect(countFilesInDir(rows, '/')).toBe(1);
    expect(countFilesInDir(rows, '/shared')).toBe(1);
  });

  it('detects direct children', () => {
    expect(isDirectChild('/', '/a.md')).toBe(true);
    expect(isDirectChild('/', '/sub/a.md')).toBe(false);
  });

  it('fallback vfs file path mapping', () => {
    const mapped: MappedVfsRow = mapVfsFilePath('/new.md');
    expect(mapped.name).toBe('new.md');
    expect(mapped.subtitle).toBe('跟随·全内容');
  });

  it('maps vfs list directory entry', () => {
    const mapped = mapVfsListEntry({path: '/drafts', kind: 'directory'});
    expect(mapped.kind).toBe('dir');
    expect(mapped.name).toBe('drafts');
    expect(mapped.subtitle).toBe('');
  });
});
