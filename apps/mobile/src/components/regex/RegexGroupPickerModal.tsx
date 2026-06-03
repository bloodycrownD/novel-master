/**
 * Workspace regex group picker: lists groups and sets PersistentState current regex group.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {RegexGroup} from '@novel-master/core';
import {useRuntime} from '../../hooks/useRuntime';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

function groupTitle(group: RegexGroup): string {
  return group.displayName?.trim() || group.groupId;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: () => void;
};

export function RegexGroupPickerModal({visible, onClose, onSelected}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<RegexGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const activeId = await runtime.state.getCurrentRegexGroupId();
      setCurrentId(activeId);
      const groups = await runtime.regexConfig.listGroups();
      setRows(groups);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => setRows([]));
    }
  }, [visible, reload]);

  const selectNone = useCallback(async () => {
    await runtime.state.resetCurrentRegexGroupId();
    onSelected?.();
    onClose();
  }, [runtime, onSelected, onClose]);

  const selectGroup = useCallback(
    async (groupId: string) => {
      await runtime.state.setCurrentRegexGroupId(groupId);
      onSelected?.();
      onClose();
    },
    [runtime, onSelected, onClose],
  );

  const disabledSelected = currentId == null || currentId === '';

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>
            选择当前正则组
          </Text>
          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <FlatList
              data={rows}
              keyExtractor={item => item.groupId}
              ListHeaderComponent={
                <Pressable
                  style={[
                    styles.row,
                    {borderBottomColor: tokens.border},
                    disabledSelected && {backgroundColor: tokens.background},
                  ]}
                  onPress={selectNone}>
                  <Text style={{color: tokens.text, flex: 1}}>不启用</Text>
                  {disabledSelected ? (
                    <Text style={{color: tokens.primary}}>当前</Text>
                  ) : null}
                </Pressable>
              }
              ListEmptyComponent={
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  暂无正则组。请先在「正则配置」页创建。
                </Text>
              }
              renderItem={({item}) => {
                const selected = item.groupId === currentId;
                return (
                  <Pressable
                    style={[
                      styles.row,
                      {borderBottomColor: tokens.border},
                      selected && {backgroundColor: tokens.background},
                    ]}
                    onPress={() => selectGroup(item.groupId)}>
                    <Text style={{color: tokens.text, flex: 1}}>
                      {groupTitle(item)}
                    </Text>
                    {selected ? (
                      <Text style={{color: tokens.primary}}>当前</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  loader: {marginVertical: 24},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cancelBtn: {alignItems: 'center', paddingTop: 12},
});
