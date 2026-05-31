/**
 * Project picker drawer (modal shell; M1 lists projects + batch delete).
 */
import React, {useEffect, useState} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {ChatProject} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  projects: ChatProject[];
  currentProjectId: string | undefined;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onDeleteSelected: (projectIds: string[]) => void | Promise<void>;
};

export function ProjectDrawer({
  visible,
  projects,
  currentProjectId,
  onClose,
  onSelect,
  onCreate,
  onDeleteSelected,
}: Props) {
  const {tokens} = useTheme();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) {
      setBatchMode(false);
      setSelectedIds(new Set());
    }
  }, [visible]);

  const toggleSelect = (projectId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const confirmBatchDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${ids.length} 个项目？将同时移除其下所有会话。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void Promise.resolve(onDeleteSelected(ids)).then(() => {
              setBatchMode(false);
              setSelectedIds(new Set());
            });
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.panel, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          {batchMode ? (
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => {
                  setBatchMode(false);
                  setSelectedIds(new Set());
                }}>
                <Text style={{color: tokens.text}}>取消</Text>
              </Pressable>
              <Text style={{color: tokens.textSecondary}}>
                已选 {selectedIds.size} 项
              </Text>
              <Pressable
                onPress={confirmBatchDelete}
                disabled={selectedIds.size === 0}>
                <Text
                  style={{
                    color:
                      selectedIds.size > 0 ? tokens.danger : tokens.textSecondary,
                  }}>
                  删除
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.headerRow}>
              <Text style={[styles.heading, {color: tokens.text}]}>项目</Text>
              <View style={styles.headerActions}>
                <Pressable onPress={() => setBatchMode(true)}>
                  <Text style={{color: tokens.text}}>管理</Text>
                </Pressable>
                <Pressable onPress={onCreate}>
                  <Text style={{color: tokens.primary}}>新建</Text>
                </Pressable>
              </View>
            </View>
          )}
          {batchMode ? (
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              选择要删除的项目（将同时移除其下所有会话）
            </Text>
          ) : null}
          <ScrollView>
            {projects.map(p => (
              <Pressable
                key={p.id}
                style={styles.row}
                onPress={() => {
                  if (batchMode) {
                    toggleSelect(p.id);
                  } else {
                    onSelect(p.id);
                    onClose();
                  }
                }}>
                <Text style={{color: tokens.text}}>
                  {batchMode && selectedIds.has(p.id) ? '✓ ' : ''}
                  {p.name}
                  {!batchMode && p.id === currentProjectId ? ' · 当前' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
  },
  panel: {
    marginTop: 56,
    maxHeight: '80%',
    padding: 16,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  heading: {fontSize: 18, fontWeight: '600'},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  headerActions: {flexDirection: 'row', gap: 16},
  hint: {fontSize: 12, marginBottom: 8},
  row: {paddingVertical: 12},
});
