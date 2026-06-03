/**
 * VFS file manager (prototype vfs-fm): list, rules, CRUD, open file editor.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import type {
  SetDirRuleInput,
  VfsScope,
  VfsService,
  WorktreeListRow,
  WorktreeService,
} from '@novel-master/core';
import {ParentDirIcon} from '../icons/TabIcons';
import {BottomSheetMenu, type SheetMenuItem} from '../sheet/BottomSheetMenu';
import {DirectoryRuleSheet} from '../sheet/DirectoryRuleSheet';
import {
  countFilesInDir,
  isDirectChild,
  mapVfsListEntry,
  mapWorktreeRow,
  parentLogicalPath,
  type MappedVfsRow,
} from './vfs-row-mapper';
import {
  createVfsDirectory,
  createVfsFile,
  deleteVfsEntry,
  remapPathUnderDir,
  renameVfsDirectory,
  renameVfsFile,
} from '../../services/vfs-operations.service';
import {
  cycleFileInclusion,
  defaultDirRuleForm,
  dirRuleToForm,
  migrateWorktreeDirRename,
  toggleDirRuleEnabled,
  vfsScopeRootPath,
} from '../../services/worktree-operations.service';
import {toastMessage} from '../../errors/toast-message';
import {useRuntime} from '../../hooks/useRuntime';
import {exportVfsZip, importVfsZip} from '../../services/vfs-zip.service';
import {useTheme} from '../../theme/ThemeProvider';
import {TemplatePullButton} from '../template/TemplatePullButton';
import {useToast} from '../chrome/ToastHost';

export type VfsFileManagerPullScope =
  | {kind: 'project'; projectId: string}
  | {kind: 'session'; sessionId: string};

export type VfsFileManagerProps = {
  scope: VfsScope;
  vfs: VfsService;
  worktree: WorktreeService;
  onOpenFile: (path: string) => void;
  rootPath?: string;
  pullFromParent?: {
    scope: VfsFileManagerPullScope;
    onPulled?: () => void;
  };
};

type PromptState = {
  title: string;
  placeholder: string;
  defaultValue: string;
  onSubmit: (value: string) => Promise<void>;
};

export function VfsFileManager({
  scope,
  vfs,
  worktree,
  onOpenFile,
  rootPath,
  pullFromParent,
}: VfsFileManagerProps) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const root = rootPath ?? vfsScopeRootPath(scope);
  const [currentPath, setCurrentPath] = useState(root);
  const [rows, setRows] = useState<MappedVfsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dirRuleOpen, setDirRuleOpen] = useState(false);
  const [dirRuleInitial, setDirRuleInitial] = useState<
    Partial<SetDirRuleInput> | undefined
  >();
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const dismissAllOverlays = useCallback(() => {
    setMenuPath(null);
    setMoreOpen(false);
    setDirRuleOpen(false);
    setPrompt(null);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  useEffect(() => {
    setCurrentPath(root);
  }, [root]);

  const [worktreeRows, setWorktreeRows] = useState<WorktreeListRow[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [listEntries, allRows] = await Promise.all([
        vfs.list(currentPath),
        worktree.buildListRows(),
      ]);
      setWorktreeRows(allRows);
      const metaByPath = new Map<string, WorktreeListRow>();
      for (const row of allRows) {
        metaByPath.set(row.path, row);
      }

      const childPaths = new Set<string>();
      for (const row of allRows) {
        if (row.kind === 'dir' && isDirectChild(currentPath, row.path)) {
          childPaths.add(row.path);
        }
      }
      for (const entry of listEntries) {
        childPaths.add(entry.path);
      }

      const mapped = [...childPaths]
        .sort((a, b) => a.localeCompare(b))
        .map(path => {
          const meta = metaByPath.get(path);
          if (meta) {
            const count =
              meta.kind === 'dir'
                ? countFilesInDir(allRows, path)
                : undefined;
            return mapWorktreeRow(meta, count);
          }
          const vfsEntry = listEntries.find(e => e.path === path);
          if (vfsEntry) {
            return mapVfsListEntry(vfsEntry);
          }
          return mapVfsListEntry({path, kind: 'file'});
        });
      setRows(mapped);
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [currentPath, vfs, worktree]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const canGoUp = currentPath !== root;
  const metaForMenu = menuPath
    ? worktreeRows.find(r => r.path === menuPath)
    : undefined;
  const menuRow = menuPath
    ? rows.find(r => r.path === menuPath) ??
      (metaForMenu
        ? mapWorktreeRow(
            metaForMenu,
            countFilesInDir(worktreeRows, menuPath),
          )
        : undefined)
    : undefined;

  const entityMenuItems: SheetMenuItem[] = menuRow
    ? menuRow.kind === 'dir'
      ? [
          {label: '进入', action: 'open'},
          {label: '规则开关', action: 'toggle-status'},
          {label: '重命名', action: 'rename'},
          {label: '删除', action: 'delete', danger: true},
        ]
      : [
          {label: '打开', action: 'open'},
          {label: '状态变更', action: 'toggle-include'},
          {label: '重命名', action: 'rename'},
          {label: '删除', action: 'delete', danger: true},
        ]
    : [];

  const moreMenuItems: SheetMenuItem[] = [
    {label: '新建目录', action: 'create-directory'},
    {label: '新建文件', action: 'create-file'},
    {label: '目录规则', action: 'directory-rule'},
    {label: '导出 ZIP', action: 'export-zip'},
    {label: '导入 ZIP', action: 'import-zip'},
  ];

  const openPrompt = (state: PromptState) => {
    setPromptValue(state.defaultValue);
    setPrompt(state);
  };

  const handleEntityAction = async (action: string) => {
    if (!menuPath || !menuRow) {
      return;
    }
    const meta = worktreeRows.find(r => r.path === menuPath);
    try {
      if (action === 'open') {
        if (menuRow.kind === 'dir') {
          setCurrentPath(menuPath);
        } else {
          onOpenFile(menuPath);
        }
        return;
      }
      if (action === 'toggle-status' && menuRow.kind === 'dir') {
        const next = await toggleDirRuleEnabled(
          worktree,
          menuPath,
          menuRow.ruleEnabled,
        );
        showToast(next ? '目录规则已开启' : '目录规则已关闭');
        await reload();
        return;
      }
      if (action === 'toggle-include' && menuRow.kind === 'file' && meta) {
        await cycleFileInclusion(worktree, menuPath, meta.inclusionMode);
        await reload();
        return;
      }
      if (action === 'rename') {
        openPrompt({
          title: '重命名',
          placeholder: '新名称',
          defaultValue: menuRow.name,
          onSubmit: async name => {
            const trimmed = name.trim();
            if (!trimmed) {
              return;
            }
            const parent = parentLogicalPath(menuPath) ?? root;
            const newPath =
              parent === '/' ? `/${trimmed}` : `${parent}/${trimmed}`;
            if (menuRow.kind === 'file') {
              await renameVfsFile(vfs, menuPath, newPath);
            } else {
              await renameVfsDirectory(vfs, menuPath, newPath);
              await migrateWorktreeDirRename(worktree, menuPath, newPath);
              if (
                currentPath === menuPath ||
                currentPath.startsWith(`${menuPath}/`)
              ) {
                setCurrentPath(remapPathUnderDir(currentPath, menuPath, newPath));
              }
            }
            await reload();
          },
        });
        return;
      }
      if (action === 'delete') {
        Alert.alert(
          '确认删除',
          `确定删除 ${menuRow.name}？`,
          [
            {text: '取消', style: 'cancel'},
            {
              text: '删除',
              style: 'destructive',
              onPress: () => {
                deleteVfsEntry(vfs, menuPath, {recursive: true})
                  .then(() => reload())
                  .catch(err =>
                    showToast(toastMessage('删除失败', err)),
                  );
              },
            },
          ],
        );
      }
    } catch (error) {
      showToast(toastMessage('操作失败', error));
    }
  };

  const handleMoreAction = (action: string) => {
    if (action === 'create-file') {
      openPrompt({
        title: '新建文件',
        placeholder: '文件名，如 note.md',
        defaultValue: '',
        onSubmit: async name => {
          const trimmed = name.trim();
          if (!trimmed) {
            return;
          }
          const path =
            currentPath === '/'
              ? `/${trimmed}`
              : `${currentPath}/${trimmed}`;
          await createVfsFile(vfs, path);
          await reload();
        },
      });
      return;
    }
    if (action === 'export-zip') {
      exportVfsZip(runtime, scope)
        .then(result => {
          if (result === 'saved') {
            showToast('ZIP 已保存到所选位置');
          }
        })
        .catch(err => showToast(toastMessage('导出失败', err)));
      return;
    }
    if (action === 'import-zip') {
      Alert.alert(
        '导入 ZIP',
        '将完全替换当前工作区文件，是否继续？',
        [
          {text: '取消', style: 'cancel'},
          {
            text: '导入',
            style: 'destructive',
            onPress: () => {
              importVfsZip(runtime, scope, {confirmed: true})
                .then(() => reload())
                .then(() => showToast('ZIP 导入完成'))
                .catch(err => showToast(toastMessage('导入失败', err)));
            },
          },
        ],
      );
      return;
    }
    if (action === 'create-directory') {
      openPrompt({
        title: '新建目录',
        placeholder: '目录名',
        defaultValue: '',
        onSubmit: async name => {
          const trimmed = name.trim();
          if (!trimmed) {
            return;
          }
          const path =
            currentPath === '/'
              ? `/${trimmed}`
              : `${currentPath}/${trimmed}`;
          await createVfsDirectory(vfs, path);
          await reload();
        },
      });
      return;
    }
    if (action === 'directory-rule') {
      void (async () => {
        try {
          const existing = await worktree.getDirRule(currentPath);
          setDirRuleInitial(
            existing != null
              ? dirRuleToForm(existing)
              : defaultDirRuleForm(currentPath),
          );
          setDirRuleOpen(true);
        } catch (error) {
          showToast(toastMessage('加载规则失败', error));
        }
      })();
    }
  };

  const badgeColors = (tone: 'in' | 'follow' | 'muted') => {
    switch (tone) {
      case 'in':
        return {backgroundColor: '#dbeafe', color: tokens.primary};
      case 'muted':
        return {backgroundColor: tokens.border, color: tokens.textSecondary};
      default:
        return {backgroundColor: '#fef3c7', color: '#92400e'};
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.header, {borderBottomColor: tokens.border}]}>
        <View style={styles.navGroup}>
          <Pressable
            disabled={!canGoUp}
            accessibilityLabel="上级目录"
            onPress={() => {
              const parent = parentLogicalPath(currentPath);
              if (parent != null) {
                setCurrentPath(parent);
              }
            }}
            style={[styles.iconBtn, !canGoUp && styles.iconBtnDisabled]}>
            <ParentDirIcon
              color={canGoUp ? tokens.primary : tokens.textSecondary}
            />
          </Pressable>
          <Text
            style={[styles.path, {color: tokens.text}]}
            numberOfLines={1}
            ellipsizeMode="middle">
            {currentPath}
          </Text>
        </View>
        {pullFromParent ? (
          <TemplatePullButton
            compact
            scope={pullFromParent.scope}
            onPulled={pullFromParent.onPulled}
          />
        ) : null}
        <Pressable onPress={() => setMoreOpen(true)} style={styles.moreBtn}>
          <Text style={{color: tokens.text, fontSize: 20}}>⋯</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={[styles.empty, {color: tokens.textSecondary}]}>
          加载中…
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.path}
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              空目录
            </Text>
          }
          renderItem={({item}) => (
            <View style={[styles.row, {borderBottomColor: tokens.border}]}>
              <Pressable
                style={styles.item}
                onPress={() => {
                  if (item.kind === 'dir') {
                    setCurrentPath(item.path);
                  } else {
                    onOpenFile(item.path);
                  }
                }}>
                <Text style={styles.kind}>{item.kind === 'dir' ? '📁' : '📄'}</Text>
                <View style={styles.textBlock}>
                  <Text style={{color: tokens.text}} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text
                    style={{color: tokens.textSecondary, fontSize: 12}}
                    numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                {item.badge ? (
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: badgeColors(item.badge.tone)
                          .backgroundColor,
                      },
                    ]}>
                    <Text
                      style={{
                        fontSize: 11,
                        color: badgeColors(item.badge.tone).color,
                      }}>
                      {item.badge.label}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => setMenuPath(item.path)}
                style={styles.menuBtn}
                hitSlop={8}>
                <Text style={{color: tokens.textSecondary, fontSize: 18}}>
                  ⋮
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <BottomSheetMenu
        visible={menuPath != null}
        items={entityMenuItems}
        onSelect={action => handleEntityAction(action)}
        onClose={() => setMenuPath(null)}
      />
      <BottomSheetMenu
        visible={moreOpen}
        items={moreMenuItems}
        onSelect={handleMoreAction}
        onClose={() => setMoreOpen(false)}
      />
      <DirectoryRuleSheet
        visible={dirRuleOpen}
        logicalPath={currentPath}
        initial={dirRuleInitial}
        onClose={() => setDirRuleOpen(false)}
        onSave={async input => {
          await worktree.setDirRule(input);
          setDirRuleInitial(input);
          await reload();
        }}
      />

      <AppModal
        visible={prompt != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPrompt(null)}>
        <View style={styles.promptBackdrop}>
          <View style={[styles.promptBox, {backgroundColor: tokens.surface}]}>
            <Text style={[styles.promptTitle, {color: tokens.text}]}>
              {prompt?.title}
            </Text>
            <TextInput
              style={[
                styles.promptInput,
                {borderColor: tokens.border, color: tokens.text},
              ]}
              placeholder={prompt?.placeholder}
              placeholderTextColor={tokens.textSecondary}
              value={promptValue}
              onChangeText={setPromptValue}
              autoFocus
            />
            <View style={styles.promptActions}>
              <Pressable onPress={() => setPrompt(null)}>
                <Text style={{color: tokens.textSecondary}}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const current = prompt;
                  if (!current) {
                    return;
                  }
                  setPrompt(null);
                  current
                    .onSubmit(promptValue)
                    .then(() => reload())
                    .catch(err =>
                      showToast(toastMessage('失败', err)),
                    );
                }}>
                <Text style={{color: tokens.primary}}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navGroup: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconBtnDisabled: {opacity: 0.4},
  path: {flex: 1, fontFamily: 'monospace', fontSize: 13},
  moreBtn: {padding: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  item: {flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12},
  kind: {fontSize: 18, marginRight: 8},
  textBlock: {flex: 1, minWidth: 0},
  badge: {borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2},
  menuBtn: {paddingHorizontal: 12, paddingVertical: 8},
  empty: {textAlign: 'center', marginTop: 32},
  promptBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  promptBox: {borderRadius: 12, padding: 16},
  promptTitle: {fontSize: 16, fontWeight: '600', marginBottom: 12},
  promptInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 16,
  },
});
