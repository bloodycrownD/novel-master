/**
 * Workspace model picker: lists saved models and sets PersistentState current model.
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
import {formatApplicationModelId} from '@novel-master/core/provider';
import {AppModal} from '../ui/AppModal';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {useTheme} from '../../theme/ThemeProvider';

export interface SavedModelRow {
  readonly applicationModelId: string;
  readonly label: string;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: (applicationModelId: string) => void;
};

export function ModelPickerModal({visible, onClose, onSelected}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<SavedModelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const workspaceId = await runtime.state.getCurrentModelId();
      setCurrentId(workspaceId);
      const providers = await runtime.providers.list();
      const collected: SavedModelRow[] = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        for (const model of saved) {
          const applicationModelId = formatApplicationModelId(
            provider.id,
            model.vendorModelId,
          );
          let label = applicationModelId;
          try {
            label = await resolveModelDisplayLabel(runtime, applicationModelId);
          } catch {
            /* keep applicationModelId */
          }
          collected.push({applicationModelId, label});
        }
      }
      collected.sort((a, b) => a.label.localeCompare(b.label));
      setRows(collected);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => setRows([]));
    }
  }, [visible, reload]);

  const select = useCallback(
    async (applicationModelId: string) => {
      await runtime.state.setCurrentModelId(applicationModelId);
      onSelected?.(applicationModelId);
      onClose();
    },
    [runtime, onSelected, onClose],
  );

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
          <Text style={[styles.title, {color: tokens.text}]}>选择工作区模型</Text>
          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <FlatList
              data={rows}
              keyExtractor={item => item.applicationModelId}
              ListEmptyComponent={
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  暂无已保存模型。请先在「服务商」页添加模型。
                </Text>
              }
              renderItem={({item}) => {
                const selected = item.applicationModelId === currentId;
                return (
                  <Pressable
                    style={[
                      styles.row,
                      {borderBottomColor: tokens.border},
                      selected && {backgroundColor: tokens.background},
                    ]}
                    onPress={() => select(item.applicationModelId)}>
                    <Text style={{color: tokens.text, flex: 1}}>
                      {item.label}
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
