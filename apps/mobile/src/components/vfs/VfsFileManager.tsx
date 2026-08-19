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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppModal } from '../ui/AppModal';
import Animated from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useAndroidModalKeyboardAvoid } from '../../hooks/useAndroidModalKeyboardAvoid';
import { useDismissOverlaysOnBlur } from '../../hooks/useDismissOverlaysOnBlur';
import {
  type PhysicalVfsService,
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
  pathWithLabels,
  remapDirectChildRows,
  type MappedVfsRow,
} from './vfs-row-mapper';
import { orderedDirectChildPaths } from './vfs-direct-children-order';
import { isUserVfsUnifiedToolTurnEnabled } from '@novel-master/core/feature-flags';

import { isVfsError } from '@novel-master/core/vfs';
import { refreshComposerStatusAfterUserVfsOps } from '../../services/user-vfs-turn-execute.service';
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
  cycleFileInclusion,
  defaultDirRuleForm,
  dirRuleToForm,
  emptyDirRuleForm,
  migrateWorkplaceDirRename,
  toggleDirRuleEnabled,
  vfsScopeRootPath,
} from '../../services/workplace-operations.service';
import { refreshRuleSnapshotAfterRuleChange } from '../../services/workplace-rule-delta-draft.service';
import { toastMessage } from '../../errors/toast-message';
import { useRuntime } from '../../hooks/useRuntime';
import { importCharacterCard } from '../../services/vfs-character-card.service';
import { exportVfsZip, importVfsZip } from '../../services/vfs-zip.service';
import { useTheme } from '../../theme/ThemeProvider';
import { TemplatePullButton } from '../template/TemplatePullButton';
import { useToast } from '../chrome/ToastHost';
import { FileReferencePicker } from '../chat/FileReferencePicker';
import {
  isSelfOrAncestorPath,
  resolveMoveDestination,
} from './vfs-move-path';

/** 仅支持 session 域 pull（project 域 pull 已拆除）。 */
export type VfsFileManagerPullScope = { kind: 'session'; sessionId: string };

/** 供父组件控制系统返回时逐级退出目录，并在切入工作区时刷新列表。 */
export type VfsFileManagerHandle = {
  canGoUp: () => boolean;
  goUp: () => void;
  reload: () => Promise<void>;
};

export type VfsFileManagerProps = {
  scope: VfsScope;
  /**
   * 列表数据源：单 scope VFS，或只读物理树（配合 readOnly 使用）。
   * 物理树只有 list/read，写操作入口由 readOnly 分支整体隐藏。
   */
  vfs: VfsService | PhysicalVfsService;
  /**
   * 工作区服务（纳入状态/目录规则/排序元数据）。可选：非工作区域（如技能目录）
   * 不传，列表退化为纯 VFS 排序，纳入/目录规则相关菜单自动隐藏。
   */
  workplace?: WorkplaceService;
  onOpenFile: (path: string) => void;
  rootPath?: string;
  pullFromParent?: {
    scope: VfsFileManagerPullScope;
    onPulled?: () => void;
  };
  /** 当前目录变化时通知父组件（用于同步系统返回状态）。 */
  onDirectoryChange?: () => void;
  /**
   * 只读模式：隐藏新建/重命名/删除/移动/ZIP 导入导出/批量/规则与
   * 「更多」菜单等全部写操作入口，仅保留目录导航与文件打开。
   * 默认（false 或不传）行为与现状完全一致，既有调用点零影响。
   */
  readOnly?: boolean;
  /**
   * 路径保护钩子：返回非空字符串 = 拒绝删除/重命名/移动的原因（如技能入口
   * SKILL.md）；返回 null/undefined = 不保护。仅拦截变更操作，不影响浏览。
   */
  isProtectedPath?: (path: string) => string | null;
  /**
   * 顶栏路径显示替换钩子：如技能目录把 `/meta/skills/foo` 前缀隐藏为 `/`。
   * 只改显示，不影响导航与逻辑路径。
   */
  pathLabel?: (path: string) => string;
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
    readOnly,
    onDirectoryChange,
    isProtectedPath,
    pathLabel,
  },
  ref,
) {
  const { tokens } = useTheme();
  const { showToast } = useToast();
  const runtime = useRuntime();
  // readOnly 模式下全部写入口已隐藏，此引用仅供写路径调用
  // （物理树类型层面无写方法，运行时不可能被写入）。
  const writableVfs = vfs as VfsService;
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
  /** 批量移动：目标目录选择器是否打开 */
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  // 内联 prompt 是居中弹层（promptBackdrop justifyContent center），
  // 上移键盘高度的一半就能露出输入框。
  const promptAvoidStyle = useAndroidModalKeyboardAvoid(0.5);

  const vfsBatchExit = useCallback(() => {
    setVfsBatchActive(prev => (prev ? false : prev));
    setVfsBatchSelected(prev => (prev.size === 0 ? prev : new Set()));
    setMovePickerOpen(false);
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

  /** 长按：进入多选并勾选该项（已在多选则仅切换勾选）。 */
  const vfsBatchLongPress = useCallback((path: string) => {
    setVfsBatchActive(prevActive => {
      if (!prevActive) {
        setVfsBatchSelected(new Set([path]));
        return true;
      }
      setVfsBatchSelected(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      return prevActive;
    });
  }, []);

  const vfsBatch = useMemo(
    () => ({
      active: vfsBatchActive,
      selectedIds: vfsBatchSelected,
      selectedCount: vfsBatchSelected.size,
      exit: vfsBatchExit,
      toggle: vfsBatchToggle,
      longPress: vfsBatchLongPress,
      isSelected: (id: string) => vfsBatchSelected.has(id),
    }),
    [
      vfsBatchActive,
      vfsBatchSelected,
      vfsBatchExit,
      vfsBatchToggle,
      vfsBatchLongPress,
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
  // 面包屑名字缓存：导航中每次 list 的合成目录行携带 label（项目名/会话名），
// 逐段累积，供顶栏路径展示替换 UUID；只影响展示，不参与导航。
  const labelByPathRef = useRef(new Map<string, string>());
  vfsRef.current = vfs;
  workplaceRef.current = workplace;
  scopeRef.current = scope;

  const fetchWorktreeRows = useCallback(
    async (): Promise<WorkplaceListRow[]> => {
      const worktreeSvc = workplaceRef.current;
      return (await worktreeSvc?.buildListRows()) ?? [];
    },
    [],
  );

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
        worktreeSvc?.getDirRule(currentPath) ?? Promise.resolve(null),
      ]);
      // 面包屑名字缓存：记录带 label 的合成目录行（项目/会话名）。
      for (const entry of listEntries) {
        if (entry.label != null) {
          labelByPathRef.current.set(entry.path, entry.label);
        }
      }
      setWorktreeRows(allRows);
      const metaByPath = new Map<string, WorkplaceListRow>();
      for (const row of allRows) {
        metaByPath.set(row.path, row);
      }

      // VFS 是版本管理的权威源；worktree（磁盘）只是物理存储。
      // worktree 上有但 VFS 没有的路径是孤儿残留（如 rename 没清理掉的旧目录壳），
      // 不应渲染给用户——否则点进去 VFS 查不到 entry 就报「已删除」。
      const vfsPathSet = new Set(listEntries.map(e => e.path));

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
      }).filter(path => vfsPathSet.has(path));

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
      // 无 workplace（非工作区域，如技能目录）：剥掉纳入状态/目录规则 tag 与
      // subtitle（跟随·全内容等是工作区语义，在此无意义）。
      setRows(
        workplace == null
          ? mapped.map(row => ({ ...row, subtitle: '', badge: null }))
          : mapped,
      );
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      reloadInFlightRef.current = false;
      setLoading(false);
    }
  }, [currentPath, fetchWorktreeRows, showToast, workplace]);

  const reloadVfsListOnly = useCallback(async () => {
    await reload();
  }, [reload]);

  const reloadAfterRuleChange = useCallback(async () => {
    await reload();
    if (sessionId != null && workplace != null) {
      try {
        await refreshRuleSnapshotAfterRuleChange(
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
    const blocked = paths
      .map(p => (isProtectedPath ? isProtectedPath(p) : null))
      .filter((reason): reason is string => reason != null);
    if (blocked.length > 0) {
      showToast(`选中项含受保护路径：${blocked[0]}`);
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
                await deleteScopedVfsEntry(runtime, scope, writableVfs, path, {
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
    isProtectedPath,
  ]);

  const runBatchMove = useCallback(
    async (targetDir: string) => {
      const paths = [...vfsBatch.selectedIds];
      if (paths.length === 0) {
        return;
      }
      const kindByPath = new Map(rows.map(r => [r.path, r.kind] as const));
      let moved = 0;
      let skipped = 0;
      for (const sourcePath of paths) {
        if (isSelfOrAncestorPath(sourcePath, targetDir)) {
          showToast('不能移动到自身或子目录');
          skipped += 1;
          continue;
        }
        const newPath = resolveMoveDestination(sourcePath, targetDir);
        if (newPath === sourcePath) {
          continue;
        }
        const kind = kindByPath.get(sourcePath);
        const isDir = kind === 'dir' || dirPathSet.has(sourcePath);
        const protectReason = isProtectedPath
          ? isProtectedPath(sourcePath)
          : null;
        if (protectReason != null) {
          showToast(protectReason);
          skipped += 1;
          continue;
        }
        try {
          // WHY: 批量时跳过每次 op 后的 composer 投影；批次结束统一刷一次。
          // 投影收窄为仅 annotate；本开关仅合并批次末 notify。
          const renameOpts = useUserVfsTurn
            ? { skipComposerStatusRefresh: true as const }
            : undefined;
          if (isDir) {
            if (useUserVfsTurn) {
              await sessionRenameVfsDirectory(
                runtime,
                sessionId!,
                sourcePath,
                newPath,
                renameOpts,
              );
            } else {
              await renameVfsDirectory(writableVfs, sourcePath, newPath);
            }
            if (workplace != null) {
              await migrateWorkplaceDirRename(workplace, sourcePath, newPath);
            }
            if (
              currentPath === sourcePath ||
              currentPath.startsWith(`${sourcePath}/`)
            ) {
              setCurrentPath(
                remapPathUnderDir(currentPath, sourcePath, newPath),
              );
            }
          } else {
            if (useUserVfsTurn) {
              await sessionRenameVfsFile(
                runtime,
                sessionId!,
                sourcePath,
                newPath,
                renameOpts,
              );
            } else {
              await renameVfsFile(writableVfs, sourcePath, newPath);
            }
          }
          moved += 1;
        } catch (err) {
          skipped += 1;
          if (isVfsError(err, 'ALREADY_EXISTS')) {
            showToast('目标已存在同名项，已跳过');
          } else {
            showToast(toastMessage('移动失败', err));
          }
        }
      }
      if (useUserVfsTurn && moved > 0 && sessionId != null) {
        await refreshComposerStatusAfterUserVfsOps(runtime, sessionId);
      }
      vfsBatch.exit();
      await reloadVfsListOnly();
      if (moved > 0 && skipped > 0) {
        showToast(`已移动 ${moved} 项，跳过 ${skipped} 项`);
      } else if (moved > 0) {
        showToast(`已移动 ${moved} 项`);
      }
    },
    [
      vfsBatch,
      rows,
      dirPathSet,
      useUserVfsTurn,
      runtime,
      sessionId,
      vfs,
      workplace,
      currentPath,
      reloadVfsListOnly,
      showToast,
      isProtectedPath,
    ],
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

  // 无 workplace（非工作区域，如技能目录）时隐藏纳入/目录规则/角色卡/ZIP 导入导出菜单
  // （技能包的导入导出在技能管理页提供）；readOnly 模式下整体置空（无任何入口可打开）。
  const entityMenuItems: SheetMenuItem[] =
    readOnly || !menuRow
      ? []
      : menuRow.kind === 'dir'
      ? [
          ...(workplace != null
            ? [
                { label: '导出 ZIP', action: 'export-zip' },
                { label: '导入 ZIP', action: 'import-zip' },
                { label: '导入角色卡', action: 'import-character-card' },
                { label: '状态变更', action: 'toggle-include' },
              ]
            : []),
          { label: '重命名', action: 'rename' },
          { label: '删除', action: 'delete', danger: true },
        ]
      : [
          ...(workplace != null
            ? [
                { label: '状态变更', action: 'toggle-include' },
              ]
            : []),
          { label: '重命名', action: 'rename' },
          { label: '删除', action: 'delete', danger: true },
        ];

  const moreMenuItems: SheetMenuItem[] = readOnly
    ? []
    : [
        { label: '新建目录', action: 'create-directory' },
        { label: '新建文件', action: 'create-file' },
        ...(workplace != null
          ? [
              { label: '导入 ZIP', action: 'import-zip' },
              { label: '导出 ZIP', action: 'export-zip' },
              { label: '导入角色卡', action: 'import-character-card' },
              { label: '目录规则', action: 'directory-rule' },
            ]
          : []),
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
    const protectReason = action === 'rename' || action === 'delete'
      ? isProtectedPath
        ? isProtectedPath(menuPath)
        : null
      : null;
    if (protectReason != null) {
      showToast(protectReason);
      return;
    }
    try {
      if (action === 'toggle-include' && meta) {
        // 纳入状态依赖 workplace；非工作区域（如技能目录）菜单已隐藏，防御双保险
        if (workplace == null) {
          return;
        }
        if (menuRow.kind === 'file' && meta.kind === 'file') {
          await cycleFileInclusion(workplace, menuPath, meta.inclusionMode);
          await refreshVisibleRowsFromWorktree();
          if (sessionId != null) {
            try {
              await refreshRuleSnapshotAfterRuleChange(
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
              await refreshRuleSnapshotAfterRuleChange(
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
                  await renameVfsFile(writableVfs, menuPath, newPath);
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
                  await renameVfsDirectory(writableVfs, menuPath, newPath);
                }
                if (workplace != null) {
                  await migrateWorkplaceDirRename(workplace, menuPath, newPath);
                }
                if (
                  currentPath === menuPath ||
                  currentPath.startsWith(`${menuPath}/`)
                ) {
                  const remapped = remapPathUnderDir(currentPath, menuPath, newPath);
                  setCurrentPath(remapped);
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
                await deleteScopedVfsEntry(runtime, scope, writableVfs, menuPath, {
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
        runExport(menuPath);
        return;
      }
      if (action === 'import-zip') {
        runImport('zip', menuPath);
        return;
      }
      if (action === 'import-character-card') {
        runImport('character-card', menuPath);
        return;
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

  // 导入 ZIP / 角色卡的共用流程：Alert 确认 → 调对应 service → 刷新列表 →
  // 为新增子目录补默认目录规则。
  // WHY: Core 的 importVfsZip / importCharacterCard 只写 VFS 目录行，
  // 不会往 workplace_dir_rule 表插入规则，导入出来的目录默认就是 rule_off。
  // 这里在导入后比对前后目录集合，给新增子目录调 setDirRule(defaultDirRuleForm)，
  // 让导入产生的目录与「新建目录」行为一致（默认开规则）。
  const runImport = (
    kind: 'zip' | 'character-card',
    targetPath: string,
  ) => {
    const title = kind === 'zip' ? '导入 ZIP' : '导入角色卡';
    const successToast = kind === 'zip' ? 'ZIP 导入完成' : '已导入角色卡';
    Alert.alert(title, zipImportConfirmCopy(targetPath), [
      { text: '取消', style: 'cancel' },
      {
        text: '导入',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            // 导入前快照 targetPath 下的目录集合，导入后比对找出新增子目录。
            const beforeDirPaths = new Set(
              (await vfs.list(targetPath))
                .filter(e => e.kind === 'directory')
                .map(e => e.path),
            );
            try {
              if (kind === 'zip') {
                await importVfsZip(runtime, scope, {
                  confirmed: true,
                  directoryPath: targetPath,
                });
              } else {
                await importCharacterCard(runtime, scope, {
                  confirmed: true,
                  directoryPath: targetPath,
                });
              }
              await reloadVfsListOnly();
              // 为新增子目录补默认目录规则；targetPath 自身已存在则跳过。
              const afterEntries = await vfs.list(targetPath);
              for (const entry of afterEntries) {
                if (entry.kind !== 'directory') {
                  continue;
                }
                if (entry.path === targetPath) {
                  continue;
                }
                if (beforeDirPaths.has(entry.path)) {
                  continue;
                }
                try {
                  if (workplace != null) {
                    await workplace.setDirRule(defaultDirRuleForm(entry.path));
                  }
                } catch {
                  // 单个目录规则写入失败不阻断整体导入流程。
                }
              }
              showToast(successToast);
            } catch (err) {
              showToast(toastMessage('导入失败', err));
            }
          })();
        },
      },
    ]);
  };

  // 导出 ZIP 的共用流程：exportingZip 守卫 → exportVfsZip → toast → 清状态。
  const runExport = (targetPath: string) => {
    if (exportingZip) {
      return;
    }
    setExportingZip(true);
    exportVfsZip(runtime, scope, { directoryPath: targetPath })
      .then(result => {
        if (result === 'saved') {
          showToast('ZIP 已保存到所选位置');
        }
      })
      .catch(err => showToast(toastMessage('导出失败', err)))
      .finally(() => setExportingZip(false));
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
            currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
          if (useUserVfsTurn) {
            await sessionCreateVfsFile(runtime, sessionId!, path);
          } else {
            await createVfsFile(writableVfs, path);
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
            await createVfsDirectory(writableVfs, path);
          }
          if (workplace != null) {
            await workplace.setDirRule(defaultDirRuleForm(path));
            await reloadAfterRuleChange();
          } else {
            await reloadVfsListOnly();
          }
        },
      });
      return;
    }
    if (action === 'directory-rule') {
      if (workplace == null) {
        return;
      }
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
    if (action === 'import-zip') {
      runImport('zip', currentPath);
      return;
    }
    if (action === 'export-zip') {
      runExport(currentPath);
      return;
    }
    if (action === 'import-character-card') {
      runImport('character-card', currentPath);
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

  // 内联 prompt 主体：iOS 走 KeyboardAvoidingView 包裹，Android 在 promptBox 上挂 translateY。
  // promptBox 改用 Animated.View，Android 分支才挂 promptAvoidStyle（translateY）。
  const promptBody = (
    <View style={styles.promptBackdrop}>
      <Animated.View
        style={[
          styles.promptBox,
          { backgroundColor: tokens.surface },
          Platform.OS === 'android' ? promptAvoidStyle : undefined,
        ]}
        onStartShouldSetResponder={() => true}>
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
            }}>
            <Text style={{ color: tokens.primary }}>确定</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );

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
            {pathLabel
              ? pathLabel(currentPath)
              : pathWithLabels(currentPath, labelByPathRef.current)}
          </Text>
        </View>
        <View style={styles.toolbarActions}>
          {!readOnly && pullFromParent ? (
            <TemplatePullButton
              iconOnly
              scope={pullFromParent.scope}
              onPulled={pullFromParent.onPulled}
            />
          ) : null}
          {!readOnly ? (
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
          ) : null}
        </View>
      </View>

      {vfsBatch.active ? (
        <VfsBatchHeader
          selectedCount={vfsBatch.selectedCount}
          onCancel={() => vfsBatch.exit()}
          onDelete={confirmBatchDelete}
          onMove={() => setMovePickerOpen(true)}
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
                  testID={`vfs-row-item-${item.name}`}
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
                  onLongPress={
                    readOnly
                      ? undefined
                      : () => {
                          vfsBatch.longPress(item.path);
                        }
                  }
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
                {vfsBatch.active || readOnly ? null : (
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
          await workplace!.setDirRule(input);
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
        {Platform.OS === 'ios' ? (
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.promptAvoidingRoot}
          >
            {promptBody}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.promptAvoidingRoot}>{promptBody}</View>
        )}
      </AppModal>

      <FileReferencePicker
        visible={movePickerOpen}
        mode="pick-directory"
        scope={scope}
        blockedSourcePaths={[...vfsBatch.selectedIds]}
        onClose={() => setMovePickerOpen(false)}
        onConfirmDir={targetDir => {
          void runBatchMove(targetDir);
        }}
      />
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
  promptAvoidingRoot: {
    flex: 1,
  },
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
