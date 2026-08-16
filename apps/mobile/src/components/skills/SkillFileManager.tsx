/**
 * 技能文件浏览器（D3：轻量新建，不复用 VfsFileManager）。
 *
 * VfsFileManager 与 WorkplaceService 深耦合（列表行合并、纳入状态、目录规则），
 * 伪 scope 需伪造 workplace 行为，裁剪成本高于自建；「复用文件浏览器」的语义
 * 是交互一致：SKILL.md 置顶、子目录导航、文件行 打开/删除（SKILL.md 保留）、
 * 目录 进入、顶部更多=新建文件（路径校验禁 `..`/`SKILL.md`/查重）。
 */
import React, {useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {SkillDomain} from '@novel-master/core/skills';
import {emitSkillFileDeleted} from '@/components/skills/skill-file-events';
import {BottomSheetMenu, type SheetMenuItem} from '@/components/sheet/BottomSheetMenu';
import {TextPromptModal} from '@/components/ui/TextPromptModal';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';

export type SkillFileManagerProps = {
  domain: SkillDomain;
  name: string;
  /** project 域必带。 */
  projectId?: string;
  /** 相对技能目录的文件路径清单（来自 listSkills 的 files）。 */
  files: readonly string[];
  /** 文件/目录结构变化（新建/删除）后通知父组件刷新清单。 */
  onFilesChanged: () => void;
  /** 打开文件（相对路径）进编辑器。 */
  onOpenFile: (relPath: string) => void;
};

/** 单行视图模型：目录或文件（rel 为相对技能目录的路径）。 */
type Entry =
  | {kind: 'dir'; name: string; rel: string}
  | {kind: 'file'; name: string; rel: string};

function normalizeRel(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, '');
}

/** SKILL.md 永远置顶，其次目录，再按文件名（交互口径对齐通用浏览器）。 */
function buildEntries(files: readonly string[], cwd: string): Entry[] {
  const prefix = cwd === '' ? '' : `${cwd}/`;
  const dirs = new Map<string, Entry>();
  const fileEntries: Entry[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix)) {
      continue;
    }
    const rest = file.slice(prefix.length);
    if (rest === '') {
      continue;
    }
    const slash = rest.indexOf('/');
    if (slash < 0) {
      fileEntries.push({kind: 'file', name: rest, rel: file});
    } else {
      const dirName = rest.slice(0, slash);
      if (!dirs.has(dirName)) {
        dirs.set(dirName, {
          kind: 'dir',
          name: dirName,
          rel: prefix + dirName,
        });
      }
    }
  }
  const skillMdRel = cwd === '' ? 'SKILL.md' : `${cwd}/SKILL.md`;
  const entryFile: Entry[] = [];
  const rest = fileEntries.filter(e => {
    if (e.rel === skillMdRel) {
      entryFile.push(e);
      return false;
    }
    return true;
  });
  return [
    ...entryFile,
    ...[...dirs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...rest.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

export function SkillFileManager({
  domain,
  name,
  projectId,
  files,
  onFilesChanged,
  onOpenFile,
}: SkillFileManagerProps) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [cwd, setCwd] = useState('');
  const [menuFile, setMenuFile] = useState<Entry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const entries = useMemo(() => buildEntries(files, cwd), [files, cwd]);
  const parentDir = cwd === '' ? null : cwd.split('/').slice(0, -1).join('/');

  const resolveVfs = () =>
    domain === 'global'
      ? runtime.globalVfs()
      : runtime.projectVfs(projectId!);

  /** 校验新建辅助文件路径：必填、禁 `..`、禁 SKILL.md、域内查重。 */
  const validateNewFilePath = (raw: string): string | null => {
    const rel = normalizeRel(raw);
    if (rel.length === 0) {
      return '路径不能为空';
    }
    if (rel.split('/').some(seg => seg === '..')) {
      return '路径不能包含 ..';
    }
    if (rel.toLowerCase() === 'skill.md' || rel.toLowerCase().endsWith('/skill.md')) {
      return 'SKILL.md 是保留入口文件，不能新建同名文件';
    }
    if (rel.split('/').some(seg => seg.length === 0)) {
      return '路径格式不正确';
    }
    if (files.includes(rel)) {
      return '该路径已存在';
    }
    return null;
  };

  const handleCreate = async (raw: string) => {
    const rel = normalizeRel(raw);
    const issue = validateNewFilePath(raw);
    if (issue != null) {
      showToast(issue);
      return;
    }
    try {
      // write 自动补父目录；空文件占位，创建后直接进编辑器
      await runtime
        .skills()
        .writeSkillFile(domain, name, rel, '', projectId);
      onFilesChanged();
      onOpenFile(rel);
    } catch (error) {
      showToast(toastMessage('新建文件失败', error));
    }
  };

  const confirmDelete = (entry: Extract<Entry, {kind: 'file'}>) => {
    Alert.alert(
      '删除辅助文件',
      `确定删除「${entry.rel}」？该操作不可撤销。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await resolveVfs().delete(`/meta/skills/${name}/${entry.rel}`);
                // 被删文件正被编辑器打开时踢回（FileEditor skill scope 监听）
                emitSkillFileDeleted({
                  domain,
                  name,
                  ...(domain === 'project' && projectId != null
                    ? {projectId}
                    : {}),
                  relPath: entry.rel,
                });
                onFilesChanged();
                showToast('已删除');
              } catch (error) {
                showToast(toastMessage('删除失败', error));
              }
            })();
          },
        },
      ],
    );
  };

  const menuItems: SheetMenuItem[] = useMemo(() => {
    if (menuFile == null) {
      return [];
    }
    const items: SheetMenuItem[] = [{label: '打开', action: 'open'}];
    if (menuFile.rel !== 'SKILL.md') {
      items.push({label: '删除', action: 'delete', danger: true});
    }
    return items;
  }, [menuFile]);

  return (
    <View style={styles.root}>
      <View style={styles.navBar}>
        <Pressable
          testID="skill-file-new"
          style={styles.newBtn}
          onPress={() => setCreateOpen(true)}>
          <Text style={{color: tokens.primary, fontSize: 13, fontWeight: '600'}}>
            ＋ 新建文件
          </Text>
        </Pressable>
        <Text
          style={[styles.cwd, {color: tokens.textSecondary}]}
          numberOfLines={1}>
          /meta/skills/{name}/{cwd}
        </Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={entry => `${entry.kind}:${entry.rel}`}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          cwd === '' ? null : (
            <Pressable
              testID="skill-file-go-up"
              style={styles.row}
              onPress={() => setCwd(parentDir ?? '')}>
              <Text style={{color: tokens.textSecondary}}>↩ 上一级</Text>
            </Pressable>
          )
        }
        ListEmptyComponent={
          <Text style={[styles.empty, {color: tokens.textSecondary}]}>
            {cwd === ''
              ? '技能目录为空（缺少 SKILL.md）'
              : '该目录暂无文件'}
          </Text>
        }
        renderItem={({item}) =>
          item.kind === 'dir' ? (
            <Pressable
              testID={`skill-file-dir-${item.name}`}
              style={styles.row}
              onPress={() => setCwd(item.rel)}
              accessibilityLabel={`进入目录 ${item.name}`}>
              <Text style={{color: tokens.text, flex: 1}} numberOfLines={1}>
                📁 {item.name}/
              </Text>
              <Text style={{color: tokens.textTertiary}}>›</Text>
            </Pressable>
          ) : (
            <View style={styles.row}>
              <Pressable
                testID={`skill-file-open-${item.name}`}
                style={styles.fileBody}
                onPress={() => onOpenFile(item.rel)}
                accessibilityLabel={`打开文件 ${item.name}`}>
                <Text style={{color: tokens.text, flex: 1}} numberOfLines={1}>
                  📄 {item.name}
                </Text>
                {item.rel === 'SKILL.md' ? (
                  <Text
                    style={[styles.entryTag, {color: tokens.textSecondary}]}>
                    入口文件
                  </Text>
                ) : null}
              </Pressable>
              <Pressable
                testID={`skill-file-menu-${item.name}`}
                hitSlop={8}
                onPress={() => setMenuFile(item)}
                accessibilityLabel={`文件 ${item.name} 更多操作`}>
                <Text style={{color: tokens.textSecondary, fontSize: 18}}>⋮</Text>
              </Pressable>
            </View>
          )
        }
      />
      <BottomSheetMenu
        visible={menuFile != null}
        title={menuFile ? `文件 ${menuFile.name}` : undefined}
        items={menuItems}
        onSelect={action => {
          const target = menuFile;
          setMenuFile(null);
          if (target == null) {
            return;
          }
          if (action === 'open') {
            onOpenFile(target.rel);
          } else if (action === 'delete' && target.kind === 'file') {
            confirmDelete(target);
          }
        }}
        onClose={() => setMenuFile(null)}
      />
      <TextPromptModal
        visible={createOpen}
        title="新建辅助文件"
        label="相对技能目录的路径（支持子目录，如 references/x.md）"
        placeholder="references/notes.md"
        confirmLabel="创建"
        onClose={() => setCreateOpen(false)}
        onConfirm={value => handleCreate(value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, minHeight: 0},
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newBtn: {paddingVertical: 6, paddingHorizontal: 8},
  cwd: {flex: 1, fontSize: 12, textAlign: 'right'},
  list: {flex: 1},
  listContent: {paddingHorizontal: 12, paddingBottom: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  fileBody: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  entryTag: {fontSize: 11},
  empty: {padding: 24, fontSize: 13, textAlign: 'center'},
});
