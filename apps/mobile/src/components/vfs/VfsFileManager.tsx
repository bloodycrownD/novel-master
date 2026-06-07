/**
 * VFS file manager (prototype vfs-fm): list, rules, CRUD, open file editor.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
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
  VfsListEntry,
  VfsScope,
  VfsService,
  WorktreeListRow,
  WorktreeService,
} from '@novel-master/core';
import {ParentDirIcon, ZipExportIcon, ZipImportIcon} from '../icons/TabIcons';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {VfsBatchHeader} from '../batch/VfsBatchHeader';
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
import {orderedDirectChildPaths} from './vfs-direct-children-order';
import {
  createVfsDirectory,
  createVfsFile,
  deleteVfsEntry,
  remapPathUnderDir,
  renameVfsDirectory,
  renameVfsFile,
} from '../../services/vfs-operations.service';
import {
  batchSetDirRulesDisabled,
  batchSetDirRulesEnabled,
  cycleFileInclusion,
  defaultDirRuleForm,
  dirRuleToForm,
  migrateWorktreeDirRename,
  vfsScopeRootPath,
} from '../../services/worktree-operations.service';
import {toastMessage} from '../../errors/toast-message';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import {exportVfsZip, importVfsZip} from '../../services/vfs-zip.service';
import {
  getOrRefreshSessionWorktreeSnapshot,
  invalidateSessionWorktreeSnapshot,
} from '../../services/worktree-snapshot.service';
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
  const batch = useBatchSelection();
  const [exportingZip, setExportingZip] = useState(false);

  const dismissAllOverlays = useCallback(() => {
    setMenuPath(null);
    setMoreOpen(false);
    setDirRuleOpen(false);
    setPrompt(null);
    batch.exit();
  }, [batch.exit]);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const invalidateSessionSnapshot = useCallback(() => {
    if (scope.kind === 'session') {
      invalidateSessionWorktreeSnapshot(
        runtime,
        scope.projectId,
        scope.sessionId,
      );
    }
  }, [runtime, scope]);

  useEffect(() => {
    setCurrentPath(root);
  }, [root]);

  const [worktreeRows, setWorktreeRows] = useState<WorktreeListRow[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loadWorktreeRows = async (): Promise<WorktreeListRow[]> => {
        if (scope.kind === 'session') {
          const snap = await getOrRefreshSessionWorktreeSnapshot(runtime, {
            projectId: scope.projectId,
            sessionId: scope.sessionId,
          });
          return [...snap.listRows];
        }
        return worktree.buildListRows();
      };
      const [listEntries, allRows, dirRule] = await Promise.all([
        vfs.list(currentPath),
        loadWorktreeRows(),
        worktree.getDirRule(currentPath),
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
      const kindByPath = new Map<string, 'dir' | 'file'>();
      for (const entry of listEntries) {
        childPaths.add(entry.path);
        kindByPath.set(
          entry.path,
          entry.kind === 'directory' ? 'dir' : entry.kind,
        );
      }

      const orderedPaths = orderedDirectChildPaths({
        parentPath: currentPath,
        rows: allRows,
        extraPaths: [...childPaths],
        dirRule: dirRule ?? null,
        kindByPath,
      });

      const mapped = orderedPaths.map(path => {
          const meta = metaByPath.get(path);
          if (meta) {
            const count =
              meta.kind === 'dir'
                ? countFilesInDir(allRows, path)
                : undefined;
            return mapWorktreeRow(meta, count);
          }
          const vfsEntry = listEntries.find((e: VfsListEntry) => e.path === path);
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
  }, [currentPath, vfs, worktree, scope, runtime]);

  const reloadAfterMutation = useCallback(async () => {
    invalidateSessionSnapshot();
    await reload();
  }, [invalidateSessionSnapshot, reload]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    batch.exit();
  }, [currentPath, batch.exit]);

  const dirPathSet = useMemo(
    () => new Set(rows.filter(r => r.kind === 'dir').map(r => r.path)),
    [rows],
  );

  const confirmBatchDelete = useCallback(() => {
    const paths = [...batch.selectedIds];
    if (paths.length === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${paths.length} 项？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                for (const path of paths) {
                  await deleteVfsEntry(vfs, path, {recursive: true});
                }
                batch.exit();
                await reloadAfterMutation();
              } catch (err) {
                showToast(toastMessage('删除失败', err));
              }
            })();
          },
        },
      ],
    );
  }, [batch, vfs, reloadAfterMutation, showToast]);

  const runBatchSetRules = useCallback(
    async (enabled: boolean) => {
      const paths = [...batch.selectedIds];
      if (paths.length === 0) {
        return;
      }
      try {
        const result = enabled
          ? await batchSetDirRulesEnabled(worktree, paths, dirPathSet)
          : await batchSetDirRulesDisabled(worktree, paths, dirPathSet);
        batch.exit();
        await reloadAfterMutation();
        if (result.skipped > 0) {
          showToast(
            enabled
              ? `已开启 ${result.applied} 个目录规则，跳过 ${result.skipped} 项`
              : `已关闭 ${result.applied} 个目录规则，跳过 ${result.skipped} 项`,
          );
        } else {
          showToast(enabled ? '目录规则已开启' : '目录规则已关闭');
        }
      } catch (error) {
        showToast(toastMessage('操作失败', error));
      }
    },
    [batch, worktree, dirPathSet, reloadAfterMutation, showToast],
  );

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
    {label: '批量操作', action: 'batch'},
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
      if (action === 'toggle-include' && menuRow.kind === 'file' && meta) {
        await cycleFileInclusion(worktree, menuPath, meta.inclusionMode);
        await reloadAfterMutation();
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
                  .then(() => reloadAfterMutation())
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

  const handleExportZip = useCallback(() => {
    setExportingZip(true);
    exportVfsZip(runtime, scope, {
      onNativeZipFallback: () =>
        showToast('原生打包失败，已改用备用方式'),
    })
      .then(result => {
        if (result === 'saved') {
          showToast('ZIP 已保存到所选位置');
        }
      })
      .catch(err => showToast(toastMessage('导出失败', err)))
      .finally(() => setExportingZip(false));
  }, [runtime, scope, showToast]);

  const handleImportZip = useCallback(() => {
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
              .then(() => reloadAfterMutation())
              .then(() => showToast('ZIP 导入完成'))
              .catch(err => showToast(toastMessage('导入失败', err)));
          },
        },
      ],
    );
  }, [runtime, scope, reloadAfterMutation, showToast]);

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
        },
      });
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
          await worktree.setDirRule(defaultDirRuleForm(path));
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
      return;
    }
    if (action === 'batch') {
      batch.enter();
      return;
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
        <View style={styles.toolbarActions}>
          {pullFromParent ? (
            <TemplatePullButton
              iconOnly
              scope={pullFromParent.scope}
              onPulled={pullFromParent.onPulled}
            />
          ) : null}
          <Pressable
            accessibilityLabel="导出 ZIP"
            disabled={exportingZip}
            onPress={handleExportZip}
            style={[styles.iconBtn, exportingZip && styles.iconBtnDisabled]}>
            {exportingZip ? (
              <ActivityIndicator size="small" color={tokens.primary} />
            ) : (
              <ZipExportIcon color={tokens.primary} />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="导入 ZIP"
            onPress={handleImportZip}
            style={styles.iconBtn}>
            <ZipImportIcon color={tokens.primary} />
          </Pressable>
          <Pressable
            accessibilityLabel="更多操作"
            onPress={() => setMoreOpen(true)}
            style={styles.iconBtn}>
            <Text style={{color: tokens.text, fontSize: 20, lineHeight: 22}}>
              ⋯
            </Text>
          </Pressable>
        </View>
      </View>

      {batch.active ? (
        <VfsBatchHeader
          selectedCount={batch.selectedCount}
          onCancel={() => batch.exit()}
          onDelete={confirmBatchDelete}
          onEnable={() => runBatchSetRules(true).catch(() => undefined)}
          onDisable={() => runBatchSetRules(false).catch(() => undefined)}
        />
      ) : null}

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
          renderItem={({item}) => {
            const selected = batch.isSelected(item.path);
            return (
            <View style={[styles.row, {borderBottomColor: tokens.border}]}>
              {batch.active ? (
                <View style={styles.batchCheckCol}>
                  <BatchCheckbox
                    checked={selected}
                    onToggle={() => batch.toggle(item.path)}
                  />
                </View>
              ) : null}
              <Pressable
                style={styles.item}
                onPress={() => {
                  if (batch.active) {
                    batch.toggle(item.path);
                    return;
                  }
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
              {batch.active ? null : (
              <Pressable
                onPress={() => setMenuPath(item.path)}
                style={styles.menuBtn}
                hitSlop={8}>
                <Text style={{color: tokens.textSecondary, fontSize: 18}}>
                  ⋮
                </Text>
              </Pressable>
              )}
            </View>
            );
          }}
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
        rootRuleLocked={currentPath === root}
        onClose={() => setDirRuleOpen(false)}
        onSave={async input => {
          await worktree.setDirRule(input);
          setDirRuleInitial(input);
          await reloadAfterMutation();
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
                    .then(() => reloadAfterMutation())
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
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  batchCheckCol: {
    width: 28,
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
