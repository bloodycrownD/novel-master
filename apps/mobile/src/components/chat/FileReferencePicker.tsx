/**
 * 只读文件/目录引用选择器：多选文件 + 单目录确认。
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
import type { MessageAttachment } from '@novel-master/core/chat';
import type { WorktreeListRow } from '@novel-master/core/worktree';
import { AppModal } from '@/components/ui/AppModal';
import { useTheme } from '@/theme/ThemeProvider';
import { formatError } from '@/errors/format-error';
import { useRuntime } from '@/hooks/useRuntime';

export type FileReferencePickerProps = {
  visible: boolean;
  projectId: string;
  sessionId: string;
  onClose: () => void;
  onConfirm: (attachments: MessageAttachment[]) => void;
};

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function toAttach(
  path: string,
  type: MessageAttachment['type'],
): MessageAttachment {
  return {
    name: basename(path),
    source: 'attach',
    type,
    content: null,
    path,
  };
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
  const [rows, setRows] = useState<WorktreeListRow[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
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
    setSelectedFiles(new Set());
    setSelectedDir(null);
    void load();
  }, [visible, load]);

  const visibleRows = useMemo(
    () =>
      rows.filter(r => {
        if (r.kind === 'dir') {
          return true;
        }
        return r.displayState !== 'hidden';
      }),
    [rows],
  );

  const canConfirm = selectedFiles.size > 0 || selectedDir != null;

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
            多选文件，或选择一个目录
          </Text>
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
                  const checked = selectedDir === item.path;
                  return (
                    <Pressable
                      style={[
                        styles.row,
                        checked && { backgroundColor: tokens.border },
                      ]}
                      onPress={() => {
                        setSelectedFiles(new Set());
                        setSelectedDir(prev =>
                          prev === item.path ? null : item.path,
                        );
                      }}
                    >
                      <Text style={{ color: tokens.text }}>📁 {label}/</Text>
                    </Pressable>
                  );
                }
                const checked = selectedFiles.has(item.path);
                return (
                  <Pressable
                    style={[
                      styles.row,
                      checked && { backgroundColor: tokens.border },
                    ]}
                    onPress={() => {
                      setSelectedDir(null);
                      setSelectedFiles(prev => {
                        const next = new Set(prev);
                        if (next.has(item.path)) {
                          next.delete(item.path);
                        } else {
                          next.add(item.path);
                        }
                        return next;
                      });
                    }}
                  >
                    <Text style={{ color: tokens.text }}>
                      {checked ? '☑' : '☐'} {label}
                    </Text>
                  </Pressable>
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
              onPress={() => {
                if (selectedDir != null) {
                  onConfirm([toAttach(selectedDir, 'dir')]);
                } else {
                  onConfirm([...selectedFiles].map(p => toAttach(p, 'text')));
                }
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
  list: { maxHeight: 360 },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
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
