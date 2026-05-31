/**
 * Project picker drawer (modal shell; lists projects + batch delete).
 */
import React, {useEffect} from 'react';
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
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {useBatchSelection} from '../../hooks/useBatchSelection';
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
  const batch = useBatchSelection();

  useEffect(() => {
    if (!visible) {
      batch.exit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when drawer closes
  }, [visible]);

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
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
              batch.exit();
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
          <ManageHeader
            title="项目"
            batchMode={batch.active}
            selectedCount={batch.selectedCount}
            onEnterBatch={batch.enter}
            onCancelBatch={batch.exit}
            onDelete={confirmBatchDelete}
            hint="选择要删除的项目（将同时移除其下所有会话）"
            normalActions={
              <Pressable onPress={onCreate}>
                <Text style={{color: tokens.primary}}>新建</Text>
              </Pressable>
            }
          />
          <ScrollView>
            {projects.map(p => (
              <Pressable
                key={p.id}
                style={styles.row}
                onPress={() => {
                  if (batch.active) {
                    batch.toggle(p.id);
                  } else {
                    onSelect(p.id);
                    onClose();
                  }
                }}>
                {batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(p.id)}
                    onToggle={() => batch.toggle(p.id)}
                  />
                ) : null}
                <Text style={{color: tokens.text, flex: 1}}>
                  {p.name}
                  {!batch.active && p.id === currentProjectId ? ' · 当前' : ''}
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
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
