/**
 * 只读文件/目录引用选择器：层级浏览 + 多选文件与目录。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { WorkplaceListRow } from '@novel-master/core/workplace';
import { AppModal } from '@/components/ui/AppModal';
import { useTheme } from '@/theme/ThemeProvider';
import { formatError } from '@/errors/format-error';
import { useRuntime } from '@/hooks/useRuntime';
import {
  isDirectChild,
  parentLogicalPath,
} from '@/components/vfs/vfs-row-mapper';
import { atPathTokensFromPickerSelection } from './composer-at-path';

export type FileReferencePickerProps = {
  visible: boolean;
  projectId: string;
  sessionId: string;
  onClose: () => void;
  /** 确认后插入正文的 `@path` token（目录带尾 `/`）。 */
  onConfirm: (atPathTokens: string[]) => void;
};

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

export { atPathTokensFromPickerSelection };

function toggleInSet(prev: Set<string>, path: string): Set<string> {
  const next = new Set(prev);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

export function FileReferencePicker({
  visible,
  projectId,
  sessionId,
  onClose,
  onConfirm,
}: FileReferencePickerProps) {
  const { tokens } = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<WorkplaceListRow[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const wt = runtime.worktree({
        kind: 'session',
        projectId,
        sessionId,
      });
      setRows(await wt.buildListRows());
    } catch (err) {
      setError(formatError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId]);

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
  }, [visible, projectId, sessionId]);

  const visibleRows = useMemo(
    () => listPickerChildRows(rows, currentPath),
    [rows, currentPath],
  );

  const parentPath = parentLogicalPath(currentPath);
  const canGoUp = parentPath != null;
  const canConfirm = selectedFiles.size > 0 || selectedDirs.size > 0;
  const currentDirSelected = selectedDirs.has(currentPath);

  const navigateInto = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  const toggleDirSelect = (dirPath: string) => {
    setSelectedDirs(prev => toggleInSet(prev, dirPath));
  };

  const selectCurrentDir = () => {
    setSelectedDirs(prev => toggleInSet(prev, currentPath));
  };

  const toggleFile = (filePath: string) => {
    setSelectedFiles(prev => toggleInSet(prev, filePath));
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
        <View style={[styles.panel, { backgroundColor: tokens.surface }]}>
          <Text style={[styles.title, { color: tokens.text }]}>引用文件</Text>
          <Text style={{ color: tokens.textSecondary, marginBottom: 8 }}>
            可多选文件与目录
          </Text>
          <View style={styles.navBar}>
            <Text
              style={[styles.cwd, { color: tokens.text }]}
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
              style={styles.navBtn}
              testID="file-ref-select-cwd"
            >
              <Text style={{ color: tokens.primary }}>
                {currentDirSelected ? '取消选用' : '选择当前文件夹'}
              </Text>
            </Pressable>
          </View>
          {error ? (
            <Text style={{ color: tokens.danger, marginBottom: 8 }}>{error}</Text>
          ) : null}
          {loading ? (
            <ActivityIndicator color={tokens.primary} />
          ) : (
            <FlatList
              data={visibleRows}
              keyExtractor={item => `${item.kind}:${item.path}`}
              style={styles.list}
              renderItem={({ item }) => {
                const label = basename(item.path) || item.path;
                if (item.kind === 'dir') {
                  const checked = selectedDirs.has(item.path);
                  return (
                    <View
                      style={styles.row}
                      testID={`file-ref-dir-${item.path}`}
                    >
                      <Pressable
                        onPress={() => toggleDirSelect(item.path)}
                        style={styles.checkHit}
                        testID={`file-ref-dir-check-${item.path}`}
                        accessibilityLabel={`选用目录 ${label}`}
                      >
                        <Text style={{ color: tokens.text }}>
                          {checked ? '☑' : '☐'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.rowBody}
                        onPress={() => navigateInto(item.path)}
                        testID={`file-ref-dir-enter-${item.path}`}
                        accessibilityLabel={`进入目录 ${label}`}
                      >
                        <Text style={{ color: tokens.text, flex: 1 }}>
                          📁 {label}/
                        </Text>
                        <Text style={{ color: tokens.textSecondary }}>›</Text>
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
                      <Text style={{ color: tokens.text }}>
                        {checked ? '☑' : '☐'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.rowBody}
                      onPress={() => toggleFile(item.path)}
                      testID={`file-ref-file-label-${item.path}`}
                      accessibilityLabel={`选用文件 ${label}`}
                    >
                      <Text style={{ color: tokens.text, flex: 1 }}>
                        📄 {label}
                      </Text>
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={{ color: tokens.textSecondary }}>暂无文件</Text>
              }
            />
          )}
          <View style={styles.foot}>
            <Pressable onPress={onClose} style={styles.footBtn}>
              <Text style={{ color: tokens.text }}>取消</Text>
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
              onPress={() => {
                onConfirm(
                  atPathTokensFromPickerSelection(selectedDirs, selectedFiles),
                );
                onClose();
              }}
            >
              <Text style={{ color: '#fff' }}>确认</Text>
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
  title: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  cwd: { flexGrow: 1, flexShrink: 1, fontSize: 13 },
  navBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  checkHit: { paddingVertical: 8, paddingHorizontal: 8 },
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
