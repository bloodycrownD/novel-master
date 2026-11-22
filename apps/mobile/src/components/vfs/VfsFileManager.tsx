/**
 * VFS file manager (prototype vfs-fm): list, rules, CRUD, open file editor.
 */
import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {Alert, FlatList, Pressable, Text, View} from 'react-native';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {type PhysicalVfsService, type VfsListEntry, type VfsScope, type VfsService} from '@novel-master/core/vfs';

import {DEFAULT_WORKPLACE_DIR_RULE, type SetDirRuleInput, type WorkplaceDirRule, type WorkplaceListRow, type WorkplaceService} from '@novel-master/core/workplace';
import {ParentDirIcon} from '../icons/TabIcons';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {BottomSheetMenu, type SheetMenuItem} from '../sheet/BottomSheetMenu';
import {DirectoryRuleSheet} from '../sheet/DirectoryRuleSheet';
import {parentLogicalPath, VfsRowMapper, type MappedVfsRow} from './vfs-row-mapper';
import {VfsDirectChildrenOrder} from './vfs-direct-children-order';
import {userVfsUnifiedToolTurnFlag} from '@novel-master/core/feature-flags';

import {AppErrorOps} from '@novel-master/core/errors';
import {Path} from '@novel-master/core/common';
import {Result, AppError} from '@novel-master/core/errors';
import {FormatError} from '../../errors/format-error';
import {UserVfsTurnExecuteService} from '../../services/user-vfs-turn-execute.service';
import {createVfsDirectory, createVfsFile, renameVfsDirectory, renameVfsFile, VfsOperationsService} from '../../services/vfs-operations.service';
import {WorkplaceOperationsService} from '../../services/workplace-operations.service';
import {WorkplaceRuleDeltaDraftService} from '../../services/workplace-rule-delta-draft.service';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';
import {useRuntime} from '../../hooks/useRuntime';
import {VfsCharacterCardService} from '../../services/vfs-character-card.service';
import {VfsSingleFileService} from '../../services/vfs-single-file.service';
import {VfsZipService} from '../../services/vfs-zip.service';
import {useTheme} from '../../theme/ThemeProvider';
import {TemplatePullButton} from '../prompt/TemplatePullButton';
import {TemplatePushButton} from '../prompt/TemplatePushButton';
import {useToast} from '../chrome/ToastHost';
import {VfsPromptModal, type VfsPromptState} from './vfs-file-manager/VfsPromptModal';
import {VfsMoveDirPicker} from './vfs-file-manager/VfsMoveDirPicker';
import {vfsBatchHeaderWrapStyle, vfsFileManagerStyles} from './vfs-file-manager/styles';
import {VfsMovePath} from './vfs-move-path';

/** 仅支持 session 域 pull（project 域 pull 已拆除）。 */
type VfsFileManagerPullScope = {kind: 'session'; sessionId: string};

/** 推送 scope 与 pull 同形：session 域工作区整树推回项目工作区（模板母本）。 */
type VfsFileManagerPushScope = {kind: 'session'; sessionId: string};

/** 供父组件控制系统返回时逐级退出目录，并在切入工作区时刷新列表。 */
export type VfsFileManagerHandle = {
    canGoUp: () => boolean;
    goUp: () => void;
    reload: () => Promise<void>;
};

type VfsFileManagerProps = {
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
    /** 推送到项目工作区：与 pullFromParent 对称，工具栏并排渲染。 */
    pushToParent?: {
        scope: VfsFileManagerPushScope;
        onPushed?: () => void;
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

type PromptState = VfsPromptState;

/* ------------------------------------------------------------------ *
 * 导入/导出菜单同源常量
 *
 * WHY 抽到模块级：行菜单（entityMenuItems）与「更多」菜单（moreMenuItems）
 * 原本各写一遍字面量，收敛后极易再次漂移。这里一份 items 两处引用，
 * 分派侧按来源（行菜单 menuPath / more 菜单 currentPath）各自接线。
 * ------------------------------------------------------------------ */

const IMPORT_MENU_ITEM: SheetMenuItem = {label: coreT({key: "ui.common.import"}), action: 'import'};
const EXPORT_MENU_ITEM: SheetMenuItem = {label: coreT({key: "ui.common.export"}), action: 'export'};

/** 导入形式选择 sheet 的标题与三项（spec D5 mobile 形态）。 */
const IMPORT_FORM_SHEET_TITLE = coreT({key: "ui.common.import"});
const IMPORT_FORM_SHEET_ITEMS: SheetMenuItem[] = [
    {label: coreT({key: "ui.vfs.import_kind_file"}), action: 'file'},
    {label: coreT({key: "ui.vfs.import_kind_zip"}), action: 'zip'},
    {label: coreT({key: "ui.vfs.import_kind_card"}), action: 'character-card'},
];

/** 批量导入（ZIP / 角色卡）的形态：三种导入各自的文案独立，不共用（spec D9）。 */
type BulkImportKind = 'zip' | 'character-card';

/** 目标目录在确认文案里的写法：根路径说人话，其余带引号原样。 */
function importTargetLabel(path: string): string {
    return path === '/' ? coreT({key: "ui.vfs.target_root_quoted"}) : `「${path}」`;
}

/** ZIP 导入：覆盖目标目录下全部文件。 */
function zipImportConfirmCopy(path: string): string {
    return coreT({key: "ui.vfs.import_overwrite_confirm", params: {target: importTargetLabel(path)}});
}

/** 角色卡导入：只覆盖目标目录下的同名角色卡文件（与 ZIP 文案语义不同）。 */
function characterCardImportConfirmCopy(path: string): string {
    return coreT({key: "ui.vfs.import_card_confirm", params: {target: importTargetLabel(path)}});
}

/** 单文件导入的同名覆盖确认文案（数量来自 core 报的 conflicts 条数）。 */
function singleFileImportConfirmCopy(conflictCount: number): string {
    return coreT({key: "ui.vfs.conflict_confirm", params: {count: conflictCount}});
}

/** 单文件导入成功 toast；非 UTF-8 跳过项非空时明示跳过数（spec D6）。 */
function singleFileImportToast(skippedBinary: readonly string[]): string {
    return skippedBinary.length > 0 ? coreT({key: "ui.vfs.single_import_skipped", params: {count: skippedBinary.length}}) : coreT({key: "ui.vfs.single_import_done"});
}

export const VfsFileManager = forwardRef<VfsFileManagerHandle, VfsFileManagerProps>(function VfsFileManager(props, ref) {
    const {scope, vfs, workplace, onOpenFile, rootPath, pullFromParent, pushToParent, readOnly, onDirectoryChange, isProtectedPath, pathLabel} = props;
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    // readOnly 模式下全部写入口已隐藏，此引用仅供写路径调用
    // （物理树类型层面无写方法，运行时不可能被写入）。
    const writableVfs = vfs as VfsService;
    const root = rootPath ?? WorkplaceOperationsService.scopeRootPath(scope);
    const sessionId = scope.kind === 'session' ? scope.sessionId : undefined;
    const useUserVfsTurn = sessionId != null && userVfsUnifiedToolTurnFlag.isEnabled();
    const [currentPath, setCurrentPath] = useState(root);
    const [rows, setRows] = useState<MappedVfsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [menuPath, setMenuPath] = useState<string | null>(null);
    const [moreOpen, setMoreOpen] = useState(false);
    const [dirRuleOpen, setDirRuleOpen] = useState(false);
    const [dirRuleInitial, setDirRuleInitial] = useState<Partial<SetDirRuleInput> | undefined>();
    const [prompt, setPrompt] = useState<PromptState | null>(null);
    /**
   * 导入形式选择 sheet 的目标目录；null = sheet 关闭。
   * 记的是「目标路径」而不是来源标记：行菜单来源取 menuPath，more 菜单来源取
   * currentPath，两条分派都在开 sheet 前把目标写进来。
   */
    const [importSheetTarget, setImportSheetTarget] = useState<string | null>(null);
    const [vfsBatchActive, setVfsBatchActive] = useState(false);
    const [vfsBatchSelected, setVfsBatchSelected] = useState<Set<string>>(() => new Set());
    /**
   * 导出 in-flight 守卫：ZIP 导出与单文件导出共用一个 boolean，两者互斥，
   * 防止用户连点重复拉起系统导出面板（spec D7）。
   */
    const [exporting, setExporting] = useState(false);
    /** 批量移动：目标目录选择器是否打开 */
    const [movePickerOpen, setMovePickerOpen] = useState(false);

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
        [vfsBatchActive, vfsBatchSelected, vfsBatchExit, vfsBatchToggle, vfsBatchLongPress],
    );

    const dismissAllOverlays = useCallback(() => {
        setMenuPath(null);
        setMoreOpen(false);
        setDirRuleOpen(false);
        setPrompt(null);
        setImportSheetTarget(null);
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

    const fetchWorktreeRows = useCallback(async (): Promise<Result<WorkplaceListRow[], AppError>> => {
        const worktreeSvc = workplaceRef.current;
        if (worktreeSvc == null) {
            return Result.ok([]);
        }
        const built = await worktreeSvc.buildListRows();
        if (!built.ok) return Result.err(built.error);
        return Result.ok(built.value);
    }, []);

    const applyWorktreeRowsToVisibleList = useCallback(
        (allRows: WorkplaceListRow[]) => {
            setWorktreeRows(allRows);
            setRows(prev => VfsRowMapper.remapDirectChildRows(prev, currentPath, allRows));
        },
        [currentPath],
    );

    const refreshVisibleRowsFromWorktree = useCallback(async (): Promise<Result<void, AppError>> => {
        const allRows = await fetchWorktreeRows();
        if (!allRows.ok) return Result.err(allRows.error);
        applyWorktreeRowsToVisibleList(allRows.value);
        return Result.ok(undefined);
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
            const [listResult, allRowsResult, dirRuleResult] = await Promise.all([vfsSvc.list(currentPath), fetchWorktreeRows(), worktreeSvc?.getDirRule(currentPath) ?? Promise.resolve(null)]);
            // 已知失败走 Result 收口（错误通道迁移四期）；未知异常仍走下方 catch。
            if (!listResult.ok) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), listResult.error));
                return;
            }
            const listEntries = listResult.value;
            let dirRule: WorkplaceDirRule | undefined;
            if (dirRuleResult != null) {
                if (!dirRuleResult.ok) {
                    showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), dirRuleResult.error));
                    return;
                }
                dirRule = dirRuleResult.value;
            }
            const allRows = allRowsResult.ok ? allRowsResult.value : [];
            // 智能排序目录才拉预编译规则（懒加载；其它排序方式零额外查表）。
            const compiledRules = (dirRule?.sortField ?? DEFAULT_WORKPLACE_DIR_RULE.sortField) === 'smart' ? await runtime.smartSortRule.listCompiledRules() : undefined;
            if (compiledRules != null && !compiledRules.ok) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), compiledRules.error));
                return;
            }
            const smartRules = compiledRules?.value;
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
                if (row.kind === 'dir' && VfsRowMapper.isDirectChild(currentPath, row.path)) {
                    childPaths.add(row.path);
                }
            }
            const kindByPath = new Map<string, 'dir' | 'file'>();
            for (const entry of listEntries) {
                childPaths.add(entry.path);
                kindByPath.set(entry.path, entry.kind === 'directory' ? 'dir' : entry.kind);
            }

            const orderedPaths = VfsDirectChildrenOrder.orderedDirectChildPaths({
                parentPath: currentPath,
                rows: allRows,
                extraPaths: [...childPaths],
                dirRule: dirRule ?? null,
                kindByPath,
                smartRules,
            }).filter(path => vfsPathSet.has(path));

            const mapped = orderedPaths.map(path => {
                const meta = metaByPath.get(path);
                if (meta) {
                    const count = meta.kind === 'dir' ? VfsRowMapper.countFilesInDir(allRows, path) : undefined;
                    return VfsRowMapper.mapWorktreeRow(meta, count);
                }
                const vfsEntry = listEntries.find((e: VfsListEntry) => e.path === path);
                if (vfsEntry) {
                    return VfsRowMapper.mapVfsListEntry(vfsEntry);
                }
                return VfsRowMapper.mapVfsListEntry({path, kind: 'file'});
            });
            // 无 workplace（非工作区域，如技能目录）：剥掉纳入状态/目录规则 tag 与
            // subtitle（跟随·全内容等是工作区语义，在此无意义）。
            setRows(workplace == null ? mapped.map(row => ({...row, subtitle: '', badge: null})) : mapped);
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), error));
        } finally {
            reloadInFlightRef.current = false;
            setLoading(false);
        }
    }, [currentPath, fetchWorktreeRows, showToast, workplace, runtime]);

    const reloadVfsListOnly = useCallback(async () => {
        await reload();
    }, [reload]);

    const reloadAfterRuleChange = useCallback(async () => {
        await reload();
        if (sessionId != null && workplace != null) {
            try {
                await WorkplaceRuleDeltaDraftService.refreshRuleSnapshot(runtime, workplace, sessionId);
            } catch {
                // 差集推送失败不阻断列表刷新
            }
        }
    }, [reload, runtime, sessionId, workplace]);

    const createManagerHandle = () => ({
        canGoUp: () => currentPath !== root,
        goUp,
        reload,
    });
    useImperativeHandle(ref, createManagerHandle, [currentPath, root, goUp, reload]);

    useEffect(() => {
        reload().catch(() => undefined);
    }, [reload]);

    useEffect(() => {
        vfsBatchExit();
    }, [currentPath, vfsBatchExit]);

    const dirPathSet = useMemo(() => new Set(rows.filter(r => r.kind === 'dir').map(r => r.path)), [rows]);

    const confirmBatchDelete = useCallback(() => {
        const paths = [...vfsBatch.selectedIds];
        if (paths.length === 0) {
            return;
        }
        const blocked = paths.map(p => (isProtectedPath ? isProtectedPath(p) : null)).filter((reason): reason is string => reason != null);
        if (blocked.length > 0) {
            showToast(coreT({key: "ui.vfs.protected_path_blocked", params: {path: blocked[0]}}));
            return;
        }
        Alert.alert(coreT({key: "ui.common.confirm_delete"}), coreT({key: "ui.common.confirm_count_msg", params: {count: paths.length}}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.delete"}),
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        try {
                            for (const path of paths) {
                                const deleteOptions = {recursive: true, useUserVfsTurn, sessionId};
                                const deleted = await VfsOperationsService.deleteScopedEntry({runtime, scope, vfs: writableVfs, path, ...deleteOptions});
                                if (!deleted.ok) {
                                    showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), deleted.error));
                                    return;
                                }
                            }
                            vfsBatch.exit();
                            await reloadVfsListOnly();
                        } catch (err) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err));
                        }
                    })();
                },
            },
        ]);
    }, [vfsBatch, vfs, reloadVfsListOnly, showToast, runtime, scope, useUserVfsTurn, sessionId, isProtectedPath]);

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
                if (VfsMovePath.isSelfOrAncestorPath(sourcePath, targetDir)) {
                    showToast(coreT({key: "ui.vfs.move_self_blocked"}));
                    skipped += 1;
                    continue;
                }
                const newPath = VfsMovePath.resolveMoveDestination(sourcePath, targetDir);
                if (newPath === sourcePath) {
                    continue;
                }
                const kind = kindByPath.get(sourcePath);
                const isDir = kind === 'dir' || dirPathSet.has(sourcePath);
                const protectReason = isProtectedPath ? isProtectedPath(sourcePath) : null;
                if (protectReason != null) {
                    showToast(protectReason);
                    skipped += 1;
                    continue;
                }
                try {
                    // WHY: 批量时跳过每次 op 后的 composer 投影；批次结束统一刷一次。
                    // 投影收窄为仅 annotate；本开关仅合并批次末 notify。
                    const renameOpts = useUserVfsTurn ? {skipComposerStatusRefresh: true as const} : undefined;
                    const moveFailed = (err: unknown): void => {
                        skipped += 1;
                        if (AppErrorOps.is(err, 'VFS_ALREADY_EXISTS')) {
                            showToast(coreT({key: "ui.vfs.target_exists_skipped"}));
                        } else {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.move_failed"}), err));
                        }
                    };
                    if (isDir) {
                        if (useUserVfsTurn) {
                            const renamed = await VfsOperationsService.sessionRenameFile({runtime, sessionId: sessionId!, oldPath: sourcePath, newPath, options: renameOpts});
                            if (!renamed.ok) {
                                moveFailed(renamed.error);
                                continue;
                            }
                        } else {
                            const renamed = await renameVfsDirectory(writableVfs, sourcePath, newPath);
                            if (!renamed.ok) {
                                moveFailed(renamed.error);
                                continue;
                            }
                        }
                        if (workplace != null) {
                            await WorkplaceOperationsService.migrateDirRename(workplace, sourcePath, newPath);
                        }
                        if (currentPath === sourcePath || currentPath.startsWith(`${sourcePath}/`)) {
                            setCurrentPath(Path.remapUnderDir(currentPath, sourcePath, newPath));
                        }
                    } else {
                        if (useUserVfsTurn) {
                            const renamed = await VfsOperationsService.sessionRenameFile({runtime, sessionId: sessionId!, oldPath: sourcePath, newPath, options: renameOpts});
                            if (!renamed.ok) {
                                moveFailed(renamed.error);
                                continue;
                            }
                        } else {
                            const renamed = await renameVfsFile(writableVfs, sourcePath, newPath);
                            if (!renamed.ok) {
                                moveFailed(renamed.error);
                                continue;
                            }
                        }
                    }
                    moved += 1;
                } catch (err) {
                    skipped += 1;
                    if (AppErrorOps.is(err, 'VFS_ALREADY_EXISTS')) {
                        showToast(coreT({key: "ui.vfs.target_exists_skipped"}));
                    } else {
                        showToast(ToastMessage.toast(coreT({key: "ui.common.move_failed"}), err));
                    }
                }
            }
            if (useUserVfsTurn && moved > 0 && sessionId != null) {
                await UserVfsTurnExecuteService.refreshComposerStatus(sessionId);
            }
            vfsBatch.exit();
            await reloadVfsListOnly();
            if (moved > 0 && skipped > 0) {
                showToast(coreT({key: "ui.vfs.moved_skipped", params: {moved, skipped}}));
            } else if (moved > 0) {
                showToast(coreT({key: "ui.vfs.moved_count", params: {count: moved}}));
            }
        },
        [vfsBatch, rows, dirPathSet, useUserVfsTurn, runtime, sessionId, vfs, workplace, currentPath, reloadVfsListOnly, showToast, isProtectedPath],
    );

    const canGoUp = currentPath !== root;
    const handleGoUp = goUp;
    const metaForMenu = menuPath ? worktreeRows.find(r => r.path === menuPath) : undefined;
    const menuRow = menuPath ? rows.find(r => r.path === menuPath) ?? (metaForMenu ? VfsRowMapper.mapWorktreeRow(metaForMenu, VfsRowMapper.countFilesInDir(worktreeRows, menuPath)) : undefined) : undefined;

    // 无 workplace（非工作区域，如技能目录）时隐藏纳入/目录规则/角色卡/ZIP 导入导出菜单
    // （技能包的导入导出在技能管理页提供）；readOnly 模式下整体置空（无任何入口可打开）。
    // dir 分支的「导入」「导出」与 more 菜单同源常量；file 分支新增「导出」（同样包在
    // workplace 门控内——技能详情页不传 workplace，不能在那里泄漏导出入口）。
    let entityMenuItems: SheetMenuItem[];
    if (readOnly || !menuRow) {
        entityMenuItems = [];
    } else if (menuRow.kind === 'dir') {
        entityMenuItems = [
            ...(workplace != null ? [EXPORT_MENU_ITEM, IMPORT_MENU_ITEM, {label: coreT({key: "ui.vfs.menu_status_change"}), action: 'toggle-include'}] : []),
            {label: coreT({key: "ui.common.rename"}), action: 'rename'},
            {label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true},
        ];
    } else {
        entityMenuItems = [
            ...(workplace != null ? [EXPORT_MENU_ITEM, {label: coreT({key: "ui.vfs.menu_status_change"}), action: 'toggle-include'}] : []),
            {label: coreT({key: "ui.common.rename"}), action: 'rename'},
            {label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true},
        ];
    }

    let moreMenuItems: SheetMenuItem[];
    if (readOnly) {
        moreMenuItems = [];
    } else {
        moreMenuItems = [
            {label: coreT({key: "ui.vfs.menu_create_directory"}), action: 'create-directory'},
            {label: coreT({key: "ui.vfs.create_file"}), action: 'create-file'},
            ...(workplace != null ? [IMPORT_MENU_ITEM, EXPORT_MENU_ITEM, {label: coreT({key: "ui.vfs.menu_directory_rule"}), action: 'directory-rule'}] : []),
        ];
    }

    /** 导入形式 sheet 的 items：readOnly 下必须为空（只读屏不留任何写入口）。 */
    const importFormSheetItems: SheetMenuItem[] = readOnly ? [] : IMPORT_FORM_SHEET_ITEMS;

    const openPrompt = (state: PromptState) => {
        setPrompt(state);
    };

    // 提交内联 prompt：先关弹窗，再执行操作并统一刷新/报错。
    const submitPrompt = (value: string) => {
        const current = prompt;
        if (!current) {
            return;
        }
        setPrompt(null);
        const submitPromise = current.onSubmit(value);
        submitPromise.then(() => reloadVfsListOnly()).catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.failed"}), err)));
    };

    const handleEntityAction = async (action: string) => {
        if (!menuPath || !menuRow) {
            return;
        }
        const meta = worktreeRows.find(r => r.path === menuPath);
        const protectReason = action === 'rename' || action === 'delete' ? (isProtectedPath ? isProtectedPath(menuPath) : null) : null;
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
                    await WorkplaceOperationsService.cycleFileInclusion(workplace, menuPath, meta.inclusionMode);
                    const refreshed = await refreshVisibleRowsFromWorktree();
                    if (!refreshed.ok) {
                        showToast(ToastMessage.toast(coreT({key: "ui.common.op_failed"}), refreshed.error));
                        return;
                    }
                    if (sessionId != null) {
                        try {
                            await WorkplaceRuleDeltaDraftService.refreshRuleSnapshot(runtime, workplace, sessionId);
                        } catch {
                            // ignore
                        }
                    }
                    return;
                }
                if (menuRow.kind === 'dir') {
                    const nextEnabledResult = await WorkplaceOperationsService.toggleDirRuleEnabled(workplace, menuPath, menuRow.ruleEnabled);
                    if (!nextEnabledResult.ok) {
                        showToast(ToastMessage.toast(coreT({key: "ui.common.op_failed"}), nextEnabledResult.error));
                        return;
                    }
                    const nextEnabled = nextEnabledResult.value;
                    showToast(nextEnabled ? coreT({key: "ui.vfs.rule_enabled_done"}) : coreT({key: "ui.vfs.rule_disabled_done"}));
                    setWorktreeRows(prev => prev.map(row => (row.path === menuPath && row.kind === 'dir' ? {...row, ruleState: nextEnabled ? 'rule_on' : 'rule_off'} : row)));
                    setRows(prev => prev.map(row => (row.path === menuPath ? VfsRowMapper.patchDirRuleRow(row, nextEnabled) : row)));
                    // WHY: child file inclusion/display only changes inside the toggled dir.
                    if (currentPath === menuPath || currentPath.startsWith(`${menuPath}/`)) {
                        await reload();
                    }
                    if (sessionId != null) {
                        try {
                            await WorkplaceRuleDeltaDraftService.refreshRuleSnapshot(runtime, workplace, sessionId);
                        } catch {
                            // ignore
                        }
                    }
                    return;
                }
            }
            if (action === 'rename') {
                openPrompt({
                    title: coreT({key: "ui.common.rename"}),
                    placeholder: coreT({key: "ui.vfs.rename_placeholder"}),
                    defaultValue: menuRow.name,
                    onSubmit: async name => {
                        const trimmed = name.trim();
                        if (!trimmed) {
                            return;
                        }
                        const parent = parentLogicalPath(menuPath) ?? root;
                        const newPath = parent === '/' ? `/${trimmed}` : `${parent}/${trimmed}`;
                        const renameFailed = (err: unknown): void => {
                            // WHY: 重命名失败的文案统一走 core formatVfsErrorForUser
                            // 的 code 文案表（ALREADY_EXISTS → 名称不能重复），与
                            // desktop 收敛到同一份映射，不再本地分支。
                            showToast(FormatError.formatVfsForUser(err));
                        };
                        try {
                            if (menuRow.kind === 'file') {
                                if (useUserVfsTurn) {
                                    const renamed = await VfsOperationsService.sessionRenameFile({runtime, sessionId: sessionId!, oldPath: menuPath, newPath});
                                    if (!renamed.ok) {
                                        renameFailed(renamed.error);
                                        return;
                                    }
                                } else {
                                    const renamed = await renameVfsFile(writableVfs, menuPath, newPath);
                                    if (!renamed.ok) {
                                        renameFailed(renamed.error);
                                        return;
                                    }
                                }
                            } else {
                                if (useUserVfsTurn) {
                                    const renamed = await VfsOperationsService.sessionRenameFile({runtime, sessionId: sessionId!, oldPath: menuPath, newPath});
                                    if (!renamed.ok) {
                                        renameFailed(renamed.error);
                                        return;
                                    }
                                } else {
                                    const renamed = await renameVfsDirectory(writableVfs, menuPath, newPath);
                                    if (!renamed.ok) {
                                        renameFailed(renamed.error);
                                        return;
                                    }
                                }
                                if (workplace != null) {
                                    await WorkplaceOperationsService.migrateDirRename(workplace, menuPath, newPath);
                                }
                                if (currentPath === menuPath || currentPath.startsWith(`${menuPath}/`)) {
                                    const remapped = Path.remapUnderDir(currentPath, menuPath, newPath);
                                    setCurrentPath(remapped);
                                }
                            }
                            await reloadVfsListOnly();
                        } catch (err) {
                            // WHY: 重命名失败的文案统一走 core formatVfsErrorForUser
                            // 的 code 文案表（ALREADY_EXISTS → 名称不能重复），与
                            // desktop 收敛到同一份映射，不再本地分支。
                            showToast(FormatError.formatVfsForUser(err));
                        }
                    },
                });
                return;
            }
            if (action === 'delete') {
                Alert.alert(coreT({key: "ui.common.confirm_delete"}), coreT({key: "ui.common.delete_named_confirm", params: {name: menuRow.name}}), [
                    {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                    {
                        text: coreT({key: "ui.common.delete"}),
                        style: 'destructive',
                        onPress: () => {
                            const runDelete = async () => {
                                const deleteOptions = {recursive: true, useUserVfsTurn, sessionId};
                                const deleted = await VfsOperationsService.deleteScopedEntry({runtime, scope, vfs: writableVfs, path: menuPath, ...deleteOptions});
                                if (!deleted.ok) {
                                    showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), deleted.error));
                                    return;
                                }
                                await reloadVfsListOnly();
                            };
                            runDelete().catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err)));
                        },
                    },
                ]);
                return;
            }
            if (action === 'export') {
                // dir 行导出 ZIP，file 行导出单文件——同一「导出」按行类型分流
                // （menuRow 在闭包内有效，见入口守卫时序注释）。
                runExport(menuRow.kind === 'file' ? 'file' : 'zip', menuPath);
                return;
            }
            if (action === 'import') {
                setImportSheetTarget(menuPath);
                return;
            }
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.op_failed"}), error));
        }
    };

    /**
   * ZIP / 角色卡导入的共用流程：Alert 确认 → 调对应 service → 刷新列表 → toast。
   *
   * 文案三份独立（spec D9）：ZIP 覆盖目标目录全部内容，角色卡只覆盖同名角色卡，
   * 单文件走 runImportFile 的「同名文件数」确认框（不共用这里的 Alert）。
   * 目录规则默认开启由 Core 导入链路在事务内统一保证（ensureImportDirRules，
   * 含任意深度嵌套、已有 rule_off 行不覆盖），UI 层不再补行——旧方案补行发生在
   * 列表刷新之后且只覆盖一层子目录，会出现「先显示关闭、进出文件夹才变开启」。
   */
    const runImport = (kind: BulkImportKind, targetPath: string) => {
        const title = kind === 'zip' ? coreT({key: "ui.vfs.import_zip_title"}) : coreT({key: "ui.vfs.import_card_title"});
        const successToast = kind === 'zip' ? coreT({key: "ui.vfs.zip_import_done"}) : coreT({key: "ui.vfs.card_import_done"});
        const confirmCopy = kind === 'zip' ? zipImportConfirmCopy(targetPath) : characterCardImportConfirmCopy(targetPath);
        Alert.alert(title, confirmCopy, [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.import"}),
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        try {
                            if (kind === 'zip') {
                                const imported = await VfsZipService.importZip(runtime, scope, {confirmed: true, directoryPath: targetPath});
                                if (!imported.ok) {
                                    showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), imported.error));
                                    return;
                                }
                            } else {
                                await VfsCharacterCardService.import(runtime, scope, {
                                    confirmed: true,
                                    directoryPath: targetPath,
                                });
                            }
                            await reloadVfsListOnly();
                            showToast(successToast);
                        } catch (err) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), err));
                        }
                    })();
                },
            },
        ]);
    };

    /**
   * 单文件导入：调单文件服务 → 有同名冲突先 Alert 确认（确认走服务挂在结果上的
   * confirm 闭包，保证写的就是用户看到的那个文件）→ 刷新列表 → toast。
   * picker 取消静默返回，不弹任何提示。
   */
    const runImportFile = async (targetPath: string) => {
        try {
            const imported = await VfsSingleFileService.importFile(runtime, scope, {targetDir: targetPath});
            if (!imported.ok) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), imported.error));
                return;
            }
            const result = imported.value;
            if (result.status === 'cancelled') {
                return;
            }
            if (result.status === 'needs-confirm') {
                const {conflictCount, confirm} = result;
                Alert.alert(coreT({key: "ui.vfs.import_single_title"}), singleFileImportConfirmCopy(conflictCount), [
                    {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                    {
                        text: coreT({key: "ui.common.import"}),
                        style: 'destructive',
                        onPress: () => {
                            void (async () => {
                                try {
                                    const applied = await confirm();
                                    if (!applied.ok) {
                                        showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), applied.error));
                                        return;
                                    }
                                    await reloadVfsListOnly();
                                    showToast(singleFileImportToast(applied.value.skippedBinary));
                                } catch (err) {
                                    showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), err));
                                }
                            })();
                        },
                    },
                ]);
                return;
            }
            await reloadVfsListOnly();
            showToast(singleFileImportToast(result.skippedBinary));
        } catch (err) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), err));
        }
    };

    /** 导入形式 sheet 的分派：三项各自走对应链路（单文件不与批量共用 Alert）。 */
    const handleImportFormAction = (form: string) => {
        const target = importSheetTarget;
        if (target == null) {
            return;
        }
        if (form === 'file') {
            void runImportFile(target);
            return;
        }
        if (form === 'zip') {
            runImport('zip', target);
            return;
        }
        if (form === 'character-card') {
            runImport('character-card', target);
        }
    };

    /**
   * 导出的统一编排：exporting 守卫 → 按 kind 分流到服务 → toast → 清状态。
   *
   * WHY 收敛成一个函数（原先 ZIP 与单文件两份复制）：两条分支的
   * 「守卫 → 服务 → 成功 toast → 失败 toast → 清状态」骨架完全同形，复制两份必然
   * 随改动漂移；守卫本身就是共用的（一个 exporting 布尔，spec D7），两份各判一次
   * 反而容易漏改出「两个守卫」的错觉。kind 只影响调哪个服务与成功文案。
   */
    const runExport = (kind: 'zip' | 'file', targetPath: string) => {
        if (exporting) {
            return;
        }
        setExporting(true);
        const task = kind === 'zip' ? VfsZipService.exportZip(runtime, scope, {directoryPath: targetPath}) : VfsSingleFileService.exportFile(runtime, scope, targetPath);
        task
            .then(result => {
                if (!result.ok) {
                    showToast(ToastMessage.toast(coreT({key: "ui.common.export_failed"}), result.error));
                    return;
                }
                if (result.value === 'saved') {
                    showToast(kind === 'zip' ? coreT({key: "ui.common.zip_saved"}) : coreT({key: "ui.vfs.file_saved_location"}));
                }
            })
            .catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.export_failed"}), err)))
            .finally(() => setExporting(false));
    };

    const handleMoreAction = (action: string) => {
        if (action === 'create-file') {
            openPrompt({
                title: coreT({key: "ui.vfs.create_file"}),
                placeholder: coreT({key: "ui.vfs.create_file_placeholder"}),
                defaultValue: '',
                onSubmit: async name => {
                    const trimmed = name.trim();
                    if (!trimmed) {
                        return;
                    }
                    const path = currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
                    if (useUserVfsTurn) {
                        const created = await VfsOperationsService.sessionCreateFile(runtime, sessionId!, path);
                        if (!created.ok) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.failed"}), created.error));
                            return;
                        }
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
                title: coreT({key: "ui.vfs.menu_create_directory"}),
                placeholder: coreT({key: "ui.vfs.create_directory_placeholder"}),
                defaultValue: '',
                onSubmit: async name => {
                    const trimmed = name.trim();
                    if (!trimmed) {
                        return;
                    }
                    const path = currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
                    if (useUserVfsTurn) {
                        const created = await VfsOperationsService.sessionCreateDirectory(runtime, sessionId!, path);
                        if (!created.ok) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.failed"}), created.error));
                            return;
                        }
                    } else {
                        await createVfsDirectory(writableVfs, path);
                    }
                    if (workplace != null) {
                        await workplace.setDirRule(WorkplaceOperationsService.defaultDirRuleForm(path));
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
                    const existingRule = await workplace.getDirRule(currentPath);
                    if (!existingRule.ok) {
                        showToast(ToastMessage.toast(coreT({key: "ui.vfs.rule_load_failed"}), existingRule.error));
                        return;
                    }
                    const existing = existingRule.value;
                    const listRow = worktreeRows.find(r => r.path === currentPath && r.kind === 'dir');
                    let initialForm: Partial<SetDirRuleInput>;
                    if (existing != null) {
                        initialForm = WorkplaceOperationsService.dirRuleToForm(existing);
                    } else {
                        initialForm = {...WorkplaceOperationsService.emptyDirRuleForm(currentPath), ruleEnabled: listRow?.kind === 'dir' ? listRow.ruleState === 'rule_on' : currentPath === root};
                    }
                    setDirRuleInitial(initialForm);
                    setDirRuleOpen(true);
                } catch (error) {
                    showToast(ToastMessage.toast(coreT({key: "ui.vfs.rule_load_failed"}), error));
                }
            })();
            return;
        }
        if (action === 'import') {
            setImportSheetTarget(currentPath);
            return;
        }
        if (action === 'export') {
            // more 菜单只出现在目录列表里，目标恒为当前目录 → ZIP 导出。
            runExport('zip', currentPath);
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

    // 内联 prompt（重命名/新建）拆到 vfs-file-manager/VfsPromptModal。

    return (
        <View style={[styles.root, {backgroundColor: tokens.background}]}>
            <View style={[styles.header, {borderBottomColor: tokens.border}]}>
                <View style={styles.navGroup}>
                    <Pressable disabled={!canGoUp} accessibilityLabel={coreT({key: "ui.vfs.parent_dir_aria"})} onPress={handleGoUp} style={[styles.iconBtn, !canGoUp && styles.iconBtnDisabled]}>
                        <ParentDirIcon color={canGoUp ? tokens.primary : tokens.textSecondary} />
                    </Pressable>
                    <Text testID="vfs-current-path" style={[styles.path, {color: tokens.text}]} numberOfLines={1} ellipsizeMode="middle">
                        {pathLabel ? pathLabel(currentPath) : VfsRowMapper.pathWithLabels(currentPath, labelByPathRef.current)}
                    </Text>
                </View>
                <View style={styles.toolbarActions}>
                    {!readOnly && pullFromParent ? <TemplatePullButton iconOnly scope={pullFromParent.scope} onPulled={pullFromParent.onPulled} /> : null}
                    {!readOnly && pushToParent ? <TemplatePushButton iconOnly scope={pushToParent.scope} onPushed={pushToParent.onPushed} /> : null}
                    {!readOnly ? (
                        <Pressable testID="vfs-more-action" accessibilityLabel={coreT({key: "ui.vfs.more_actions_aria"})} onPress={() => setMoreOpen(true)} style={styles.iconBtn}>
                            <Text style={{color: tokens.text, fontSize: 20, lineHeight: 22}}>⋯</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>

            {vfsBatch.active ? (
                <ManageHeader
                    batchMode
                    selectedCount={vfsBatch.selectedCount}
                    onCancelBatch={() => vfsBatch.exit()}
                    onDelete={confirmBatchDelete}
                    hint={coreT({key: "ui.vfs.batch_hint"})}
                    actions={[
                        {
                            label: coreT({key: "ui.common.move"}),
                            onPress: () => setMovePickerOpen(true),
                        },
                    ]}
                    style={vfsBatchHeaderWrapStyle}
                />
            ) : null}

            {loading ? (
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.common.loading"})}</Text>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={item => item.path}
                    ListEmptyComponent={<Text style={[styles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.vfs.empty_dir"})}</Text>}
                    renderItem={({item}) => {
                        const selected = vfsBatch.isSelected(item.path);
                        return (
                            <View testID={`vfs-row-${item.name}`} style={[styles.row, {borderBottomColor: tokens.border}]}>
                                {vfsBatch.active ? (
                                    <View style={styles.batchCheckCol}>
                                        <BatchCheckbox checked={selected} onToggle={() => vfsBatch.toggle(item.path)} />
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
                                    <Text style={styles.kind}>{item.kind === 'dir' ? '📁' : '📄'}</Text>
                                    <View style={styles.textBlock}>
                                        <Text style={{color: tokens.text}} numberOfLines={1}>
                                            {item.name}
                                        </Text>
                                        <Text style={{color: tokens.textSecondary, fontSize: 12}} numberOfLines={1}>
                                            {item.subtitle}
                                        </Text>
                                    </View>
                                    {item.badge ? (
                                        <View
                                            style={[
                                                styles.badge,
                                                {
                                                    backgroundColor: badgeColors(item.badge.tone).backgroundColor,
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
                                    <Pressable testID={`vfs-row-menu-${item.name}`} onPress={() => setMenuPath(item.path)} style={styles.menuBtn} hitSlop={8}>
                                        <Text style={{color: tokens.textSecondary, fontSize: 18}}>⋮</Text>
                                    </Pressable>
                                )}
                            </View>
                        );
                    }}
                />
            )}

            <BottomSheetMenu visible={menuPath != null} items={entityMenuItems} onSelect={action => handleEntityAction(action)} onClose={() => setMenuPath(null)} />
            <BottomSheetMenu visible={moreOpen} items={moreMenuItems} onSelect={handleMoreAction} onClose={() => setMoreOpen(false)} />
            <BottomSheetMenu
                visible={!readOnly && importSheetTarget != null}
                title={IMPORT_FORM_SHEET_TITLE}
                items={importFormSheetItems}
                onSelect={handleImportFormAction}
                onClose={() => setImportSheetTarget(null)}
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

            {prompt ? <VfsPromptModal state={prompt} onCancel={() => setPrompt(null)} onSubmit={submitPrompt} /> : null}

            <VfsMoveDirPicker
                visible={movePickerOpen}
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

const styles = vfsFileManagerStyles;
