/**
 * 只读文件/目录选择器：
 * - at-ref（默认）：层级浏览 + 多选文件与目录，产出 @path token（ChatComposer）
 * - pick-directory：注入 VfsScope，单选目标目录（批量移动）
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {WorkplaceListRow} from '@novel-master/core/workplace';
import type {VfsScope} from '@novel-master/core/vfs';
import {AppModal} from '@/components/ui/AppModal';
import {useTheme} from '@/theme/ThemeProvider';
import {formatError} from '@/errors/format-error';
import {useRuntime} from '@/hooks/useRuntime';
import {
  isDirectChild,
  parentLogicalPath,
} from '@/components/vfs/vfs-row-mapper';
import {isBlockedMoveTarget} from '@/components/vfs/vfs-move-path';
import {atPathTokensFromPickerSelection} from './composer-at-path';

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

export type FileReferencePickerProps =
  | AtRefPickerProps
  | PickDirectoryPickerProps;

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** 当前目录下的直子行（不含 cwd 自身；目录与文件均显示，含隐藏文件）。 */
export function listPickerChildRows(
  rows: readonly WorkplaceListRow[],
  currentPath: string,
): WorkplaceListRow[] {
  return rows.filter(r => isDirectChild(currentPath, r.path));
}

/** pick-directory 模式只列目录，隐藏文件勾选。 */
export function listPickerDirectoryChildRows(
  rows: readonly WorkplaceListRow[],
  currentPath: string,
): WorkplaceListRow[] {
  return listPickerChildRows(rows, currentPath).filter(r => r.kind === 'dir');
}

export {atPathTokensFromPickerSelection};

function toggleInSet(prev: Set<string>, path: string): Set<string> {
  const next = new Set(prev);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

function resolveWorkplaceScope(props: FileReferencePickerProps): VfsScope {
  if (props.mode === 'pick-directory') {
    return props.scope;
  }
  return {
    kind: 'session',
    projectId: props.projectId,
    sessionId: props.sessionId,
  };
}

export function FileReferencePicker(props: FileReferencePickerProps) {
  const {visible, onClose} = props;
  const isPickDirectory = props.mode === 'pick-directory';
  const blockedSourcePaths = isPickDirectory
    ? props.blockedSourcePaths ?? []
    : [];
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<WorkplaceListRow[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const workplaceScope = resolveWorkplaceScope(props);
  const scopeKey = useMemo(
    () => JSON.stringify(workplaceScope),
    [workplaceScope],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const wt = runtime.workplace(workplaceScope);
      setRows(await wt.buildListRows());
    } catch (err) {
      setError(formatError(err));
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

  const visibleRows = useMemo(
    () =>
      isPickDirectory
        ? listPickerDirectoryChildRows(rows, currentPath)
        : listPickerChildRows(rows, currentPath),
    [rows, currentPath, isPickDirectory],
  );

  const parentPath = parentLogicalPath(currentPath);
  const canGoUp = parentPath != null;
  const cwdBlocked = isPickDirectory
    ? isBlockedMoveTarget(currentPath, blockedSourcePaths)
    : false;
  const canConfirmAtRef = selectedFiles.size > 0 || selectedDirs.size > 0;
  const canConfirmPickDir = !cwdBlocked;
  const canConfirm = isPickDirectory ? canConfirmPickDir : canConfirmAtRef;
  const currentDirSelected = selectedDirs.has(currentPath);

  const navigateInto = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  const toggleDirSelect = (dirPath: string) => {
    setSelectedDirs(prev => toggleInSet(prev, dirPath));
  };

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
    setSelectedDirs(prev => toggleInSet(prev, currentPath));
  };

  const toggleFile = (filePath: string) => {
    setSelectedFiles(prev => toggleInSet(prev, filePath));
  };

  const handleConfirm = () => {
    if (props.mode === 'pick-directory') {
      confirmPickDirectory();
      return;
    }
    props.onConfirm(
      atPathTokensFromPickerSelection(selectedDirs, selectedFiles),
    );
    onClose();
  };

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
          <Text style={[styles.title, {color: tokens.text}]}>
            {isPickDirectory ? '选择目标目录' : '引用文件'}
          </Text>
          <Text style={{color: tokens.textSecondary, marginBottom: 8}}>
            {isPickDirectory
              ? '浏览到目标文件夹后确认；不可选中源自身或其子树'
              : '可多选文件与目录'}
          </Text>
          <View style={styles.navBar}>
            <Text
              style={[styles.cwd, {color: tokens.text}]}
              numberOfLines={1}
              testID="file-ref-cwd"
            >
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
                上一级
              </Text>
            </Pressable>
            <Pressable
              onPress={selectCurrentDir}
              disabled={isPickDirectory && cwdBlocked}
              style={styles.navBtn}
              testID="file-ref-select-cwd"
            >
              <Text
                style={{
                  color:
                    isPickDirectory && cwdBlocked
                      ? tokens.textSecondary
                      : tokens.primary,
                }}
              >
                {isPickDirectory
                  ? '选择当前文件夹'
                  : currentDirSelected
                  ? '取消选用'
                  : '选择当前文件夹'}
              </Text>
            </Pressable>
          </View>
          {cwdBlocked ? (
            <Text
              style={{color: tokens.danger, marginBottom: 8}}
              testID="file-ref-cwd-blocked"
            >
              当前目录是源自身或子树，不能作为目标
            </Text>
          ) : null}
          {error ? (
            <Text style={{color: tokens.danger, marginBottom: 8}}>{error}</Text>
          ) : null}
          {loading ? (
            <ActivityIndicator color={tokens.primary} />
          ) : (
            <FlatList
              data={visibleRows}
              keyExtractor={item => `${item.kind}:${item.path}`}
              style={styles.list}
              renderItem={({item}) => {
                const label = basename(item.path) || item.path;
                if (item.kind === 'dir') {
                  const dirBlocked =
                    isPickDirectory &&
                    isBlockedMoveTarget(item.path, blockedSourcePaths);
                  const checked = selectedDirs.has(item.path);
                  return (
                    <View
                      style={styles.row}
                      testID={`file-ref-dir-${item.path}`}
                    >
                      {isPickDirectory ? null : (
                        <Pressable
                          onPress={() => toggleDirSelect(item.path)}
                          style={styles.checkHit}
                          testID={`file-ref-dir-check-${item.path}`}
                          accessibilityLabel={`选用目录 ${label}`}
                        >
                          <Text style={{color: tokens.text}}>
                            {checked ? '☑' : '☐'}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        style={styles.rowBody}
                        onPress={() => navigateInto(item.path)}
                        testID={`file-ref-dir-enter-${item.path}`}
                        accessibilityLabel={`进入目录 ${label}`}
                      >
                        <Text
                          style={{
                            color: dirBlocked
                              ? tokens.textSecondary
                              : tokens.text,
                            flex: 1,
                          }}
                        >
                          📁 {label}/{dirBlocked ? '（不可作目标）' : ''}
                        </Text>
                        <Text style={{color: tokens.textSecondary}}>›</Text>
                      </Pressable>
                    </View>
                  );
                }
                const checked = selectedFiles.has(item.path);
                return (
                  <View
                    style={styles.row}
                    testID={`file-ref-file-row-${item.path}`}
                  >
                    <Pressable
                      onPress={() => toggleFile(item.path)}
                      style={styles.checkHit}
                      testID={`file-ref-file-${item.path}`}
                      accessibilityLabel={`选用文件 ${label}`}
                    >
                      <Text style={{color: tokens.text}}>
                        {checked ? '☑' : '☐'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.rowBody}
                      onPress={() => toggleFile(item.path)}
                      testID={`file-ref-file-label-${item.path}`}
                      accessibilityLabel={`选用文件 ${label}`}
                    >
                      <Text style={{color: tokens.text, flex: 1}}>
                        📄 {label}
                      </Text>
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={{color: tokens.textSecondary}}>
                  {isPickDirectory ? '暂无子目录' : '暂无文件'}
                </Text>
              }
            />
          )}
          <View style={styles.foot}>
            <Pressable onPress={onClose} style={styles.footBtn}>
              <Text style={{color: tokens.text}}>取消</Text>
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
              <Text style={{color: '#fff'}}>确认</Text>
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
