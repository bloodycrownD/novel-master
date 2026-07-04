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
import {formatSavedModelDisplayName} from '@novel-master/core/provider';
import {AppModal} from '../ui/AppModal';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';

export interface SavedModelRow {
  readonly savedModelId: string;
  readonly label: string;
  readonly subtitle?: string;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelected?: (savedModelId: string) => void;
};

function modelNameKey(providerId: string, modelName: string): string {
  return `${providerId}\0${modelName}`;
}

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
      setCurrentId(workspaceId ?? undefined);
      const providers = await runtime.providers.list();
      const allModels: Array<{
        id: string;
        providerId: string;
        modelName: string;
        vendorModelId: string;
      }> = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        for (const model of saved) {
          allModels.push({
            id: model.id,
            providerId: model.providerId,
            modelName: model.modelName,
            vendorModelId: model.vendorModelId,
          });
        }
      }
      const nameCounts = new Map<string, number>();
      for (const model of allModels) {
        const key = modelNameKey(model.providerId, model.modelName);
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const collected: SavedModelRow[] = allModels.map(model => {
        const duplicate =
          (nameCounts.get(modelNameKey(model.providerId, model.modelName)) ??
            0) > 1;
        return {
          savedModelId: model.id,
          label: formatSavedModelDisplayName(model.providerId, model.modelName),
          subtitle: duplicate ? model.vendorModelId : undefined,
        };
      });
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
    async (savedModelId: string) => {
      await runtime.state.setCurrentModelId(savedModelId);
      onSelected?.(savedModelId);
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
              keyExtractor={item => item.savedModelId}
              ListEmptyComponent={
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  暂无已保存模型。请先在「服务商」页添加模型。
                </Text>
              }
              renderItem={({item}) => {
                const selected = item.savedModelId === currentId;
                return (
                  <Pressable
                    style={[
                      styles.row,
                      {borderBottomColor: tokens.border},
                      selected && {backgroundColor: tokens.background},
                    ]}
                    onPress={() => select(item.savedModelId)}>
                    <View style={styles.rowText}>
                      <Text style={{color: tokens.text}}>{item.label}</Text>
                      {item.subtitle ? (
                        <Text
                          style={[
                            styles.subtitle,
                            {color: tokens.textSecondary},
                          ]}>
                          {item.subtitle}
                        </Text>
                      ) : null}
                    </View>
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
  rowText: {flex: 1, gap: 2},
  subtitle: {fontSize: 12},
  cancelBtn: {alignItems: 'center', paddingTop: 12},
});
