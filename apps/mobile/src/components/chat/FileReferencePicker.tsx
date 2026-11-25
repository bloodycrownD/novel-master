/**
 * 只读文件/目录选择器：
 * - at-ref（默认）：层级浏览 + 多选文件与目录，产出 @path token（ChatComposer）
 * - pick-directory：注入 VfsScope，单选目标目录（批量移动）
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import type {WorkplaceListRow} from '@novel-master/core/workplace';
import type {VfsScope} from '@novel-master/core/vfs';
import {AppModal} from '@/components/ui/AppModal';
import {coreT} from '@/i18n/core';
import {useTheme} from '@/theme/ThemeProvider';
import {FormatError} from '@/errors/format-error';
import {useRuntime} from '@/hooks/useRuntime';
import {VfsRowMapper, parentLogicalPath} from '@/components/vfs/vfs-row-mapper';
import {VfsMovePath} from '@/components/vfs/vfs-move-path';
import {composerAtPath} from './composer-at-path';

type AtRefPickerProps = {
    visible: boolean;
    /** 默认 at-ref：会话工作区多选引用 */
    mode?: 'at-ref';
    projectId: string;
    sessionId: string;
    onClose: () => void;
    /** 确认后插入正文的 `@path` token（目录带尾 `/`）。 */
    onConfirm: (atPathTokens: string[]) => void;
};

type PickDirectoryPickerProps = {
    visible: boolean;
    mode: 'pick-directory';
    /** 与 VfsFileManager 相同的 scope（global / project / session） */
    scope: VfsScope;
    /** 禁止作为目标的源路径（自身及其子树） */
    blockedSourcePaths?: readonly string[];
    onClose: () => void;
    onConfirmDir: (path: string) => void;
};

type FileReferencePickerProps = AtRefPickerProps | PickDirectoryPickerProps;

export {composerAtPath};

// 偏离登记：文件名 FileReferencePicker 与组件同名，tsx helper namespace 不得撞组件名，
// 按内容主体（picker 子行过滤）起名 PickerRows；成员名不含完整主体词干，保留全名。
export namespace PickerRows {
    /** 当前目录下的直子行（不含 cwd 自身；目录与文件均显示，含隐藏文件）。 */
    export function listPickerChildRows(rows: readonly WorkplaceListRow[], currentPath: string): WorkplaceListRow[] {
        return rows.filter(r => VfsRowMapper.isDirectChild(currentPath, r.path));
    }

    /** pick-directory 模式只列目录，隐藏文件勾选。 */
    export function listPickerDirectoryChildRows(rows: readonly WorkplaceListRow[], currentPath: string): WorkplaceListRow[] {
        return PickerRows.listPickerChildRows(rows, currentPath).filter(r => r.kind === 'dir');
    }

    export function toggleInSet(prev: Set<string>, path: string): Set<string> {
        const next = new Set(prev);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
        }
        return next;
    }
}

export function FileReferencePicker(props: FileReferencePickerProps) {
    const {visible, onClose} = props;
    const isPickDirectory = props.mode === 'pick-directory';
    const blockedSourcePaths = isPickDirectory ? props.blockedSourcePaths ?? [] : [];
    const {tokens} = useTheme();
    const runtime = useRuntime();
    const [rows, setRows] = useState<WorkplaceListRow[]>([]);
    const [currentPath, setCurrentPath] = useState('/');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | undefined>();
    const [loading, setLoading] = useState(false);

    const workplaceScope: VfsScope = props.mode === 'pick-directory' ? props.scope : {kind: 'session', projectId: props.projectId, sessionId: props.sessionId};
    const scopeKey = useMemo(() => JSON.stringify(workplaceScope), [workplaceScope]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(undefined);
        try {
            const wt = runtime.workplace(workplaceScope);
            const built = await wt.buildListRows();
            // 已知失败走 Result 收口（错误通道迁移四期）；未知异常仍走异常通道。
            if (built.ok) {
                setRows(built.value);
            } else {
                setError(FormatError.format(built.error));
                setRows([]);
            }
        } catch (err) {
            setError(FormatError.format(err));
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [runtime, workplaceScope]);

    useEffect(() => {
        if (!visible) {
            return;
        }
        // 打开时重置 cwd 与选中集；仅依赖 visible/scope，避免 load 引用抖动导致死循环
        setCurrentPath('/');
        setSelectedFiles(new Set());
        setSelectedDirs(new Set());
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开瞬时拉一次列表
    }, [visible, scopeKey]);

    const visibleRows = useMemo(() => (isPickDirectory ? PickerRows.listPickerDirectoryChildRows(rows, currentPath) : PickerRows.listPickerChildRows(rows, currentPath)), [rows, currentPath, isPickDirectory]);

    const parentPath = parentLogicalPath(currentPath);
    const canGoUp = parentPath != null;
    const cwdBlocked = isPickDirectory ? VfsMovePath.isBlockedMoveTarget(currentPath, blockedSourcePaths) : false;
    const canConfirmAtRef = selectedFiles.size > 0 || selectedDirs.size > 0;
    const canConfirmPickDir = !cwdBlocked;
    const canConfirm = isPickDirectory ? canConfirmPickDir : canConfirmAtRef;
    const currentDirSelected = selectedDirs.has(currentPath);

    // pick-directory 两入口（选择当前文件夹 / 底部确认）共用同一条确认路径。
    const confirmPickDirectory = () => {
        if (props.mode !== 'pick-directory' || cwdBlocked) {
            return;
        }
        props.onConfirmDir(currentPath);
        onClose();
    };

    const selectCurrentDir = () => {
        if (props.mode === 'pick-directory') {
            confirmPickDirectory();
            return;
        }
        setSelectedDirs(prev => PickerRows.toggleInSet(prev, currentPath));
    };

    const toggleFile = (filePath: string) => {
        setSelectedFiles(prev => PickerRows.toggleInSet(prev, filePath));
    };

    const handleConfirm = () => {
        if (props.mode === 'pick-directory') {
            confirmPickDirectory();
            return;
        }
        const tokens = composerAtPath.tokensFromPickerSelection(selectedDirs, selectedFiles);
        if (!tokens.ok) {
            setError(FormatError.format(tokens.error));
            return;
        }
        props.onConfirm(tokens.value);
        onClose();
    };

    // 目录选择模式固定显示「选择当前文件夹」，文件引用模式按当前目录是否已选切换文案
    let selectDirLabel: string;
    if (isPickDirectory) {
        selectDirLabel = coreT({key: "ui.chat.select_current_folder"});
    } else if (currentDirSelected) {
        selectDirLabel = coreT({key: "ui.chat.deselect_current_folder"});
    } else {
        selectDirLabel = coreT({key: "ui.chat.select_current_folder"});
    }

    return (
        <AppModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
                    <Text style={[styles.title, {color: tokens.text}]}>{isPickDirectory ? coreT({key: "ui.chat.pick_target_dir_title"}) : coreT({key: "ui.chat.reference_files"})}</Text>
                    <Text style={{color: tokens.textSecondary, marginBottom: 8}}>{isPickDirectory ? coreT({key: "ui.chat.pick_dir_hint"}) : coreT({key: "ui.chat.file_ref_hint"})}</Text>
                    <View style={styles.navBar}>
                        <Text style={[styles.cwd, {color: tokens.text}]} numberOfLines={1} testID="file-ref-cwd">
                            {currentPath}
                        </Text>
                        <Pressable
                            disabled={!canGoUp}
                            onPress={() => {
                                if (parentPath != null) {
                                    setCurrentPath(parentPath);
                                }
                            }}
                            style={styles.navBtn}
                            testID="file-ref-go-up"
                        >
                            <Text
                                style={{
                                    color: canGoUp ? tokens.primary : tokens.textSecondary,
                                }}
                            >
                                {coreT({key: "ui.chat.parent_dir"})}
                            </Text>
                        </Pressable>
                        <Pressable onPress={selectCurrentDir} disabled={isPickDirectory && cwdBlocked} style={styles.navBtn} testID="file-ref-select-cwd">
                            <Text
                                style={{
                                    color: isPickDirectory && cwdBlocked ? tokens.textSecondary : tokens.primary,
                                }}
                            >
                                {selectDirLabel}
                            </Text>
                        </Pressable>
                    </View>
                    {cwdBlocked ? (
                        <Text style={{color: tokens.danger, marginBottom: 8}} testID="file-ref-cwd-blocked">
                            {coreT({key: "ui.chat.dir_blocked_hint"})}
                        </Text>
                    ) : null}
                    {error ? <Text style={{color: tokens.danger, marginBottom: 8}}>{error}</Text> : null}
                    {loading ? (
                        <ActivityIndicator color={tokens.primary} />
                    ) : (
                        <FlatList
                            data={visibleRows}
                            keyExtractor={item => `${item.kind}:${item.path}`}
                            style={styles.list}
                            renderItem={({item}) => {
                                const pathParts = item.path.split('/').filter(Boolean);
                                const label = pathParts[pathParts.length - 1] ?? item.path;
                                if (item.kind === 'dir') {
                                    const dirBlocked = isPickDirectory && VfsMovePath.isBlockedMoveTarget(item.path, blockedSourcePaths);
                                    const checked = selectedDirs.has(item.path);
                                    return (
                                        <View style={styles.row} testID={`file-ref-dir-${item.path}`}>
                                            {isPickDirectory ? null : (
                                                <Pressable
                                                    onPress={() => setSelectedDirs(prev => PickerRows.toggleInSet(prev, item.path))}
                                                    style={styles.checkHit}
                                                    testID={`file-ref-dir-check-${item.path}`}
                                                    accessibilityLabel={coreT({key: "ui.chat.pick_dir_aria", params: {label}})}
                                                >
                                                    <Text style={{color: tokens.text}}>{checked ? '☑' : '☐'}</Text>
                                                </Pressable>
                                            )}
                                            <Pressable style={styles.rowBody} onPress={() => setCurrentPath(item.path)} testID={`file-ref-dir-enter-${item.path}`} accessibilityLabel={coreT({key: "ui.chat.enter_dir_aria", params: {label}})}>
                                                <Text
                                                    style={{
                                                        color: dirBlocked ? tokens.textSecondary : tokens.text,
                                                        flex: 1,
                                                    }}
                                                >
                                                    📁 {label}{dirBlocked ? coreT({key: "ui.chat.pick_dir_blocked"}) : ''}
                                                </Text>
                                                <Text style={{color: tokens.textSecondary}}>›</Text>
                                            </Pressable>
                                        </View>
                                    );
                                }
                                const checked = selectedFiles.has(item.path);
                                return (
                                    <View style={styles.row} testID={`file-ref-file-row-${item.path}`}>
                                        <Pressable onPress={() => toggleFile(item.path)} style={styles.checkHit} testID={`file-ref-file-${item.path}`} accessibilityLabel={coreT({key: "ui.chat.pick_file_aria", params: {label}})}>
                                            <Text style={{color: tokens.text}}>{checked ? '☑' : '☐'}</Text>
                                        </Pressable>
                                        <Pressable style={styles.rowBody} onPress={() => toggleFile(item.path)} testID={`file-ref-file-label-${item.path}`} accessibilityLabel={coreT({key: "ui.chat.pick_file_aria", params: {label}})}>
                                            <Text style={{color: tokens.text, flex: 1}}>📄 {label}</Text>
                                        </Pressable>
                                    </View>
                                );
                            }}
                            ListEmptyComponent={<Text style={{color: tokens.textSecondary}}>{isPickDirectory ? coreT({key: "ui.chat.pick_dir_empty"}) : coreT({key: "ui.chat.pick_file_empty"})}</Text>}
                        />
                    )}
                    <View style={styles.foot}>
                        <Pressable onPress={onClose} style={styles.footBtn}>
                            <Text style={{color: tokens.text}}>{coreT({key: "ui.common.cancel"})}</Text>
                        </Pressable>
                        <Pressable
                            disabled={!canConfirm}
                            style={[
                                styles.footBtn,
                                {
                                    backgroundColor: canConfirm ? tokens.primary : tokens.border,
                                },
                            ]}
                            testID="file-ref-confirm"
                            onPress={handleConfirm}
                        >
                            <Text style={{color: '#fff'}}>{coreT({key: "ui.common.confirm_alt"})}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
    },
    panel: {
        maxHeight: '80%',
        padding: 16,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    title: {fontSize: 18, fontWeight: '600', marginBottom: 4},
    navBar: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 8,
    },
    cwd: {flexGrow: 1, flexShrink: 1, fontSize: 13},
    navBtn: {paddingVertical: 4, paddingHorizontal: 4},
    list: {maxHeight: 360},
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderRadius: 8,
    },
    checkHit: {paddingVertical: 8, paddingHorizontal: 8},
    rowBody: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingRight: 8,
    },
    foot: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 12,
    },
    footBtn: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
    },
});
