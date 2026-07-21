/**
 * VFS file manager (prototype vfs-fm): list, rules, CRUD, open file editor.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppModal } from '../ui/AppModal';
import { useDismissOverlaysOnBlur } from '../../hooks/useDismissOverlaysOnBlur';
import {
  type VfsListEntry,
  type VfsScope,
  type VfsService,
} from '@novel-master/core/vfs';

import {
  type SetDirRuleInput,
  type WorkplaceListRow,
  type WorkplaceService,
} from '@novel-master/core/workplace';
import { ParentDirIcon } from '../icons/TabIcons';
import { BatchCheckbox } from '../batch/BatchCheckbox';
import { VfsBatchHeader } from '../batch/VfsBatchHeader';
import { BottomSheetMenu, type SheetMenuItem } from '../sheet/BottomSheetMenu';
import { DirectoryRuleSheet } from '../sheet/DirectoryRuleSheet';
import {
  countFilesInDir,
  isDirectChild,
  dirRuleStateFromEnabled,
  mapVfsListEntry,
  mapWorktreeRow,
  parentLogicalPath,
  patchDirRuleRow,
  remapDirectChildRows,
  type MappedVfsRow,
} from './vfs-row-mapper';
import { orderedDirectChildPaths } from './vfs-direct-children-order';
import { isUserVfsUnifiedToolTurnEnabled } from '@novel-master/core/feature-flags';

import { isVfsError } from '@novel-master/core/vfs';
import {
  createVfsDirectory,
  createVfsFile,
  deleteScopedVfsEntry,
  remapPathUnderDir,
  renameVfsDirectory,
  renameVfsFile,
  sessionCreateVfsDirectory,
  sessionCreateVfsFile,
  sessionRenameVfsDirectory,
  sessionRenameVfsFile,
} from '../../services/vfs-operations.service';
import {
  batchSetDirRulesDisabled,
  batchSetDirRulesEnabled,
  cycleFileInclusion,
  defaultDirRuleForm,
  dirRuleToForm,
  emptyDirRuleForm,
  migrateWorkplaceDirRename,
  toggleDirRuleEnabled,
  vfsScopeRootPath,
} from '../../services/workplace-operations.service';
import { suggestWorkplaceAttachmentsToComposerDraft } from '../../services/workplace-rule-delta-draft.service';
import { toastMessage } from '../../errors/toast-message';
import { useRuntime } from '../../hooks/useRuntime';
import { exportVfsZip, importVfsZip } from '../../services/vfs-zip.service';
import {
  exportVfsBatch,
  formatBatchReportToast,
  importVfsBatch,
} from '../../services/vfs-batch.service';
import type { BatchIngestRawEntry } from '@novel-master/core/vfs';
import { useTheme } from '../../theme/ThemeProvider';
import { TemplatePullButton } from '../template/TemplatePullButton';
import { useToast } from '../chrome/ToastHost';

export type VfsFileManagerPullScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'session'; sessionId: string };

/** 供父组件控制系统返回时逐级退出目录，并在切入工作区时刷新列表。 */
export type VfsFileManagerHandle = {
  canGoUp: () => boolean;
  goUp: () => void;
  reload: () => Promise<void>;
};

export type VfsFileManagerProps = {
  scope: VfsScope;
  vfs: VfsService;
  workplace: WorkplaceService;
  onOpenFile: (path: string) => void;
  rootPath?: string;
  pullFromParent?: {
    scope: VfsFileManagerPullScope;
    onPulled?: () => void;
  };
  /** 当前目录变化时通知父组件（用于同步系统返回状态）。 */
  onDirectoryChange?: () => void;
};

type PromptState = {
  title: string;
  placeholder: string;
  defaultValue: string;
  onSubmit: (value: string) => Promise<void>;
};

export const VfsFileManager = forwardRef<
  VfsFileManagerHandle,
  VfsFileManagerProps
>(function VfsFileManager(
  {
    scope,
    vfs,
    workplace,
    onOpenFile,
    rootPath,
    pullFromParent,
    onDirectoryChange,
  },
  ref,
) {
  const { tokens } = useTheme();
  const { showToast } = useToast();
  const runtime = useRuntime();
  const root = rootPath ?? vfsScopeRootPath(scope);
  const sessionId = scope.kind === 'session' ? scope.sessionId : undefined;
  const useUserVfsTurn = sessionId != null && isUserVfsUnifiedToolTurnEnabled();
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
  const [vfsBatchActive, setVfsBatchActive] = useState(false);
  const [vfsBatchSelected, setVfsBatchSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [exportingZip, setExportingZip] = useState(false);

  const vfsBatchEnter = useCallback(() => {
    setVfsBatchActive(true);
    setVfsBatchSelected(new Set());
  }, []);

  const vfsBatchExit = useCallback(() => {
    setVfsBatchActive(prev => (prev ? false : prev));
    setVfsBatchSelected(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const vfsBatchToggle = useCallback((id: string) => {
    setVfsBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const vfsBatch = useMemo(
    () => ({
      active: vfsBatchActive,
      selectedIds: vfsBatchSelected,
      selectedCount: vfsBatchSelected.size,
      enter: vfsBatchEnter,
      exit: vfsBatchExit,
      toggle: vfsBatchToggle,
      isSelected: (id: string) => vfsBatchSelected.has(id),
    }),
    [
      vfsBatchActive,
      vfsBatchSelected,
      vfsBatchEnter,
      vfsBatchExit,
      vfsBatchToggle,
    ],
  );

  const dismissAllOverlays = useCallback(() => {
    setMenuPath(null);
    setMoreOpen(false);
    setDirRuleOpen(false);
    setPrompt(null);
    vfsBatchExit();
  }, [vfsBatchExit]);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  useEffect(() => {
    setCurrentPath(root);
  }, [root]);

  const goUp = useCallback(() => {
    const parent = parentLogicalPath(currentPath);
    if (parent != null) {
      setCurrentPath(parent);
    }
  }, [currentPath]);

  useEffect(() => {
    onDirectoryChange?.();
  }, [currentPath, onDirectoryChange]);

  const [worktreeRows, setWorktreeRows] = useState<WorkplaceListRow[]>([]);
  const vfsRef = useRef(vfs);
  const workplaceRef = useRef(workplace);
  const scopeRef = useRef(scope);
  const reloadInFlightRef = useRef(false);
  vfsRef.current = vfs;
  workplaceRef.current = workplace;
  scopeRef.current = scope;

  const fetchWorktreeRows = useCallback(async (): Promise<
    WorkplaceListRow[]
  > => {
    const worktreeSvc = workplaceRef.current;
    return worktreeSvc.buildListRows();
  }, []);

  const applyWorktreeRowsToVisibleList = useCallback(
    (allRows: WorkplaceListRow[]) => {
      setWorktreeRows(allRows);
      setRows(prev => remapDirectChildRows(prev, currentPath, allRows));
    },
    [currentPath],
  );

  const refreshVisibleRowsFromWorktree = useCallback(async () => {
    const allRows = await fetchWorktreeRows();
    applyWorktreeRowsToVisibleList(allRows);
  }, [fetchWorktreeRows, applyWorktreeRowsToVisibleList]);

  const reload = useCallback(async () => {
    if (reloadInFlightRef.current) {
      return;
    }
    reloadInFlightRef.current = true;
    const vfsSvc = vfsRef.current;
    const worktreeSvc = workplaceRef.current;
    setLoading(true);
    try {
      const [listEntries, allRows, dirRule] = await Promise.all([
        vfsSvc.list(currentPath),
        fetchWorktreeRows(),
        worktreeSvc.getDirRule(currentPath),
      ]);
      setWorktreeRows(allRows);
      const metaByPath = new Map<string, WorkplaceListRow>();
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
            meta.kind === 'dir' ? countFilesInDir(allRows, path) : undefined;
          return mapWorktreeRow(meta, count);
        }
        const vfsEntry = listEntries.find((e: VfsListEntry) => e.path === path);
        if (vfsEntry) {
          return mapVfsListEntry(vfsEntry);
        }
        return mapVfsListEntry({ path, kind: 'file' });
      });
      setRows(mapped);
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      reloadInFlightRef.current = false;
      setLoading(false);
    }
  }, [currentPath, fetchWorktreeRows, showToast]);

  const reloadVfsListOnly = useCallback(async () => {
    await reload();
  }, [reload]);

  const reloadAfterRuleChange = useCallback(async () => {
    await reload();
    if (sessionId != null) {
      try {
        await suggestWorkplaceAttachmentsToComposerDraft(
          runtime,
          workplace,
          sessionId,
        );
      } catch {
        // 差集推送失败不阻断列表刷新
      }
    }
  }, [reload, runtime, sessionId, workplace]);

  useImperativeHandle(
    ref,
    () => ({
      canGoUp: () => currentPath !== root,
      goUp,
      reload,
    }),
    [currentPath, root, goUp, reload],
  );

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    vfsBatchExit();
  }, [currentPath, vfsBatchExit]);

  const dirPathSet = useMemo(
    () => new Set(rows.filter(r => r.kind === 'dir').map(r => r.path)),
    [rows],
  );

  const confirmBatchDelete = useCallback(() => {
    const paths = [...vfsBatch.selectedIds];
    if (paths.length === 0) {
      return;
    }
    Alert.alert('确认删除', `确定删除选中的 ${paths.length} 项？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              for (const path of paths) {
                await deleteScopedVfsEntry(runtime, scope, vfs, path, {
                  recursive: true,
                  useUserVfsTurn,
                  sessionId,
                });
              }
              vfsBatch.exit();
              await reloadVfsListOnly();
            } catch (err) {
              showToast(toastMessage('删除失败', err));
            }
          })();
        },
      },
    ]);
  }, [
    vfsBatch,
    vfs,
    reloadVfsListOnly,
    showToast,
    runtime,
    scope,
    useUserVfsTurn,
    sessionId,
  ]);

  const runBatchSetRules = useCallback(
    async (enabled: boolean) => {
      const paths = [...vfsBatch.selectedIds];
      if (paths.length === 0) {
        return;
      }
      try {
        const result = enabled
          ? await batchSetDirRulesEnabled(workplace, paths, dirPathSet)
          : await batchSetDirRulesDisabled(workplace, paths, dirPathSet);
        vfsBatch.exit();
        await reloadAfterRuleChange();
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
    [vfsBatch, workplace, dirPathSet, reloadAfterRuleChange, showToast],
  );

  const canGoUp = currentPath !== root;
  const handleGoUp = goUp;
  const metaForMenu = menuPath
    ? worktreeRows.find(r => r.path === menuPath)
    : undefined;
  const menuRow = menuPath
    ? rows.find(r => r.path === menuPath) ??
      (metaForMenu
        ? mapWorktreeRow(metaForMenu, countFilesInDir(worktreeRows, menuPath))
        : undefined)
    : undefined;

  const entityMenuItems: SheetMenuItem[] = menuRow
    ? menuRow.kind === 'dir'
      ? [
          { label: '导出 ZIP', action: 'export-zip' },
          { label: '状态变更', action: 'toggle-include' },
          { label: '重命名', action: 'rename' },
          { label: '删除', action: 'delete', danger: true },
        ]
      : [
          { label: '打开', action: 'open' },
          { label: '状态变更', action: 'toggle-include' },
          { label: '重命名', action: 'rename' },
          { label: '删除', action: 'delete', danger: true },
        ]
    : [];

  const moreMenuItems: SheetMenuItem[] = [
    { label: '新建目录', action: 'create-directory' },
    { label: '新建文件', action: 'create-file' },
    { label: '导入 ZIP', action: 'import-zip' },
    { label: '批量导入', action: 'import-batch' },
    { label: '批量导出', action: 'export-batch' },
    { label: '目录规则', action: 'directory-rule' },
    { label: '批量操作', action: 'batch' },
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
      if (action === 'toggle-include' && meta) {
        if (menuRow.kind === 'file' && meta.kind === 'file') {
          await cycleFileInclusion(workplace, menuPath, meta.inclusionMode);
          await refreshVisibleRowsFromWorktree();
          if (sessionId != null) {
            try {
              await suggestWorkplaceAttachmentsToComposerDraft(
                runtime,
                workplace,
                sessionId,
              );
            } catch {
              // ignore
            }
          }
          return;
        }
        if (menuRow.kind === 'dir') {
          const nextEnabled = await toggleDirRuleEnabled(
            workplace,
            menuPath,
            menuRow.ruleEnabled,
          );
          showToast(nextEnabled ? '目录规则已开启' : '目录规则已关闭');
          setWorktreeRows(prev =>
            prev.map(row =>
              row.path === menuPath && row.kind === 'dir'
                ? { ...row, ruleState: dirRuleStateFromEnabled(nextEnabled) }
                : row,
            ),
          );
          setRows(prev =>
            prev.map(row =>
              row.path === menuPath ? patchDirRuleRow(row, nextEnabled) : row,
            ),
          );
          // WHY: child file inclusion/display only changes inside the toggled dir.
          if (
            currentPath === menuPath ||
            currentPath.startsWith(`${menuPath}/`)
          ) {
            await reload();
          }
          if (sessionId != null) {
            try {
              await suggestWorkplaceAttachmentsToComposerDraft(
                runtime,
                workplace,
                sessionId,
              );
            } catch {
              // ignore
            }
          }
          return;
        }
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
            try {
              if (menuRow.kind === 'file') {
                if (useUserVfsTurn) {
                  await sessionRenameVfsFile(
                    runtime,
                    sessionId!,
                    menuPath,
                    newPath,
                  );
                } else {
                  await renameVfsFile(vfs, menuPath, newPath);
                }
              } else {
                if (useUserVfsTurn) {
                  await sessionRenameVfsDirectory(
                    runtime,
                    sessionId!,
                    menuPath,
                    newPath,
                  );
                } else {
                  await renameVfsDirectory(vfs, menuPath, newPath);
                }
                await migrateWorkplaceDirRename(workplace, menuPath, newPath);
                if (
                  currentPath === menuPath ||
                  currentPath.startsWith(`${menuPath}/`)
                ) {
                  setCurrentPath(
                    remapPathUnderDir(currentPath, menuPath, newPath),
                  );
                }
              }
              await reloadVfsListOnly();
            } catch (err) {
              // WHY: Core rejects duplicate names; surface friendly copy on mobile.
              if (isVfsError(err, 'ALREADY_EXISTS')) {
                showToast('名称不能重复');
              } else {
                showToast(toastMessage('重命名失败', err));
              }
            }
          },
        });
        return;
      }
      if (action === 'delete') {
        Alert.alert('确认删除', `确定删除 ${menuRow.name}？`, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => {
              const runDelete = async () => {
                await deleteScopedVfsEntry(runtime, scope, vfs, menuPath, {
                  recursive: true,
                  useUserVfsTurn,
                  sessionId,
                });
                await reloadVfsListOnly();
              };
              runDelete().catch(err =>
                showToast(toastMessage('删除失败', err)),
              );
            },
          },
        ]);
        return;
      }
      if (action === 'export-zip') {
        setExportingZip(true);
        exportVfsZip(runtime, scope, { directoryPath: menuPath })
          .then(result => {
            if (result === 'saved') {
              showToast('ZIP 已保存到所选位置');
            }
          })
          .catch(err => showToast(toastMessage('导出失败', err)))
          .finally(() => setExportingZip(false));
      }
    } catch (error) {
      showToast(toastMessage('操作失败', error));
    }
  };

  const zipImportConfirmCopy = (path: string): string => {
    if (path === '/') {
      return '将覆盖目录「当前目录（工作区根）」下的全部文件，同级其他内容不受影响。是否继续？';
    }
    return `将覆盖目录「${path}」下的全部文件，同级其他内容不受影响。是否继续？`;
  };

  const handleImportZip = useCallback(() => {
    Alert.alert('导入 ZIP', zipImportConfirmCopy(currentPath), [
      { text: '取消', style: 'cancel' },
      {
        text: '导入',
        style: 'destructive',
        onPress: () => {
          importVfsZip(runtime, scope, {
            confirmed: true,
            directoryPath: currentPath,
          })
            .then(() => reloadVfsListOnly())
            .then(() => showToast('ZIP 导入完成'))
            .catch(err => showToast(toastMessage('导入失败', err)));
        },
      },
    ]);
  }, [runtime, scope, currentPath, reloadVfsListOnly, showToast]);

  const handleImportBatch = useCallback(() => {
    const runApply = (
      overwriteConfirmed: boolean,
      preparedEntries?: readonly BatchIngestRawEntry[],
    ) => {
      importVfsBatch(runtime, scope, {
        targetDir: currentPath,
        overwriteConfirmed,
        preparedEntries,
      })
        .then(async outcome => {
          if (outcome.status === 'cancelled') {
            return;
          }
          if (outcome.status === 'needs_confirm') {
            Alert.alert(
              '文件冲突',
              `目标处已有 ${outcome.plan.conflicts.length} 个同名项。覆盖后不可撤销，是否继续？`,
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '覆盖',
                  style: 'destructive',
                  onPress: () => runApply(true, outcome.plan.entries),
                },
              ],
            );
            return;
          }
          await reloadVfsListOnly();
          showToast(
            formatBatchReportToast(outcome.report, outcome.skippedBinary),
          );
        })
        .catch(err => showToast(toastMessage('批量导入失败', err)));
    };
    runApply(false);
  }, [runtime, scope, currentPath, reloadVfsListOnly, showToast]);

  const handleExportBatch = useCallback(() => {
    const logicalPaths =
      vfsBatch.active && vfsBatch.selectedCount > 0
        ? [...vfsBatch.selectedIds]
        : [currentPath];
    setExportingZip(true);
    exportVfsBatch(runtime, scope, { logicalPaths })
      .then(result => {
        if (result.status === 'saved') {
          showToast(`已导出 ${result.savedCount} 个文件`);
        } else if (result.savedCount > 0) {
          showToast(`已保存 ${result.savedCount} 个文件（其余已取消）`);
        }
      })
      .catch(err => showToast(toastMessage('批量导出失败', err)))
      .finally(() => setExportingZip(false));
  }, [
    runtime,
    scope,
    currentPath,
    vfsBatch.active,
    vfsBatch.selectedCount,
    vfsBatch.selectedIds,
    showToast,
  ]);

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
            currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
          if (useUserVfsTurn) {
            await sessionCreateVfsFile(runtime, sessionId!, path);
          } else {
            await createVfsFile(vfs, path);
          }
          await reloadVfsListOnly();
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
            currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
          if (useUserVfsTurn) {
            await sessionCreateVfsDirectory(runtime, sessionId!, path);
          } else {
            await createVfsDirectory(vfs, path);
          }
          await workplace.setDirRule(defaultDirRuleForm(path));
          await reloadAfterRuleChange();
        },
      });
      return;
    }
    if (action === 'directory-rule') {
      void (async () => {
        try {
          const existing = await workplace.getDirRule(currentPath);
          const listRow = worktreeRows.find(
            r => r.path === currentPath && r.kind === 'dir',
          );
          setDirRuleInitial(
            existing != null
              ? dirRuleToForm(existing)
              : {
                  ...emptyDirRuleForm(currentPath),
                  ruleEnabled:
                    listRow?.kind === 'dir'
                      ? listRow.ruleState === 'rule_on'
                      : currentPath === root,
                },
          );
          setDirRuleOpen(true);
        } catch (error) {
          showToast(toastMessage('加载规则失败', error));
        }
      })();
      return;
    }
    if (action === 'batch') {
      vfsBatch.enter();
      return;
    }
    if (action === 'import-zip') {
      handleImportZip();
      return;
    }
    if (action === 'import-batch') {
      handleImportBatch();
      return;
    }
    if (action === 'export-batch') {
      handleExportBatch();
    }
  };

  const badgeColors = (tone: 'in' | 'follow' | 'muted') => {
    switch (tone) {
      case 'in':
        return { backgroundColor: '#dbeafe', color: tokens.primary };
      case 'muted':
        return { backgroundColor: tokens.border, color: tokens.textSecondary };
      default:
        return { backgroundColor: '#fef3c7', color: '#92400e' };
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.background }]}>
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <View style={styles.navGroup}>
          <Pressable
            disabled={!canGoUp}
            accessibilityLabel="上级目录"
            onPress={handleGoUp}
            style={[styles.iconBtn, !canGoUp && styles.iconBtnDisabled]}
          >
            <ParentDirIcon
              color={canGoUp ? tokens.primary : tokens.textSecondary}
            />
          </Pressable>
          <Text
            style={[styles.path, { color: tokens.text }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
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
            testID="vfs-more-action"
            accessibilityLabel="更多操作"
            onPress={() => setMoreOpen(true)}
            style={styles.iconBtn}
          >
            <Text style={{ color: tokens.text, fontSize: 20, lineHeight: 22 }}>
              ⋯
            </Text>
          </Pressable>
        </View>
      </View>

      {vfsBatch.active ? (
        <VfsBatchHeader
          selectedCount={vfsBatch.selectedCount}
          onCancel={() => vfsBatch.exit()}
          onDelete={confirmBatchDelete}
          onEnable={() => runBatchSetRules(true).catch(() => undefined)}
          onDisable={() => runBatchSetRules(false).catch(() => undefined)}
        />
      ) : null}

      {loading ? (
        <Text style={[styles.empty, { color: tokens.textSecondary }]}>
          加载中…
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.path}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              空目录
            </Text>
          }
          renderItem={({ item }) => {
            const selected = vfsBatch.isSelected(item.path);
            return (
              <View
                testID={`vfs-row-${item.name}`}
                style={[styles.row, { borderBottomColor: tokens.border }]}
              >
                {vfsBatch.active ? (
                  <View style={styles.batchCheckCol}>
                    <BatchCheckbox
                      checked={selected}
                      onToggle={() => vfsBatch.toggle(item.path)}
                    />
                  </View>
                ) : null}
                <Pressable
                  style={styles.item}
                  onPress={() => {
                    if (vfsBatch.active) {
                      vfsBatch.toggle(item.path);
                      return;
                    }
                    if (item.kind === 'dir') {
                      setCurrentPath(item.path);
                    } else {
                      onOpenFile(item.path);
                    }
                  }}
                >
                  <Text style={styles.kind}>
                    {item.kind === 'dir' ? '📁' : '📄'}
                  </Text>
                  <View style={styles.textBlock}>
                    <Text style={{ color: tokens.text }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text
                      style={{ color: tokens.textSecondary, fontSize: 12 }}
                      numberOfLines={1}
                    >
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
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: badgeColors(item.badge.tone).color,
                        }}
                      >
                        {item.badge.label}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
                {vfsBatch.active ? null : (
                  <Pressable
                    testID={`vfs-row-menu-${item.name}`}
                    onPress={() => setMenuPath(item.path)}
                    style={styles.menuBtn}
                    hitSlop={8}
                  >
                    <Text style={{ color: tokens.textSecondary, fontSize: 18 }}>
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
          await workplace.setDirRule(input);
          setDirRuleInitial(input);
          await reloadAfterRuleChange();
        }}
      />

      <AppModal
        visible={prompt != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPrompt(null)}
      >
        <View style={styles.promptBackdrop}>
          <View style={[styles.promptBox, { backgroundColor: tokens.surface }]}>
            <Text style={[styles.promptTitle, { color: tokens.text }]}>
              {prompt?.title}
            </Text>
            <TextInput
              testID="vfs-prompt-input"
              style={[
                styles.promptInput,
                { borderColor: tokens.border, color: tokens.text },
              ]}
              placeholder={prompt?.placeholder}
              placeholderTextColor={tokens.textSecondary}
              value={promptValue}
              onChangeText={setPromptValue}
              autoFocus
            />
            <View style={styles.promptActions}>
              <Pressable onPress={() => setPrompt(null)}>
                <Text style={{ color: tokens.textSecondary }}>取消</Text>
              </Pressable>
              <Pressable
                testID="vfs-prompt-submit"
                onPress={() => {
                  const current = prompt;
                  if (!current) {
                    return;
                  }
                  setPrompt(null);
                  current
                    .onSubmit(promptValue)
                    .then(() => reloadVfsListOnly())
                    .catch(err => showToast(toastMessage('失败', err)));
                }}
              >
                <Text style={{ color: tokens.primary }}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </AppModal>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconBtnDisabled: { opacity: 0.4 },
  path: { flex: 1, fontFamily: 'monospace', fontSize: 13 },
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
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12 },
  kind: { fontSize: 18, marginRight: 8 },
  textBlock: { flex: 1, minWidth: 0 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  menuBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  empty: { textAlign: 'center', marginTop: 32 },
  promptBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  promptBox: { borderRadius: 12, padding: 16 },
  promptTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
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
