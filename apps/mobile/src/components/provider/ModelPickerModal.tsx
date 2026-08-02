/**
 * 模型选择器：同时服务「我的」tab（workspace 全局）与会话详情页（session 覆盖）。
 *
 * 传入 `sessionId` 时走会话级路径——`currentId` 取 session 绑定 modelId
 * （缺失回退 workspace 当前模型），选中后写 `{ modelId }` patch（保持现有 mode/agentId）。
 * 不传时维持原 workspace 行为。`locked` 用于 agent pin 场景整体禁用选择。
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
  /**
   * 传入后会话级分流：读 session 绑定 modelId 作为当前选中，写 session override。
   * 不传则维持 workspace 全局行为（「我的」tab）。
   */
  sessionId?: string;
};

function modelNameKey(providerId: string, modelName: string): string {
  return `${providerId}\0${modelName}`;
}

export function ModelPickerModal({visible, onClose, onSelected, sessionId}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<SavedModelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const workspaceId = await runtime.state.getCurrentModelId();
      let effectiveId = workspaceId ?? undefined;
      if (sessionId != null) {
        // 会话级：bind 且带 modelId 时优先，否则回退 workspace 当前模型。
        const sessionConfig = await runtime.sessions.getSessionAgentConfig(
          sessionId,
        );
        if (
          sessionConfig.mode === 'bind' &&
          sessionConfig.modelId &&
          sessionConfig.modelId.length > 0
        ) {
          effectiveId = sessionConfig.modelId;
        }
      }
      setCurrentId(effectiveId);
      const providers = await runtime.providers.list();
      const nameById = new Map(
        providers.map(provider => [provider.id, provider.displayName]),
      );
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
        const providerDisplayName =
          nameById.get(model.providerId) ?? '未知服务商';
        return {
          savedModelId: model.id,
          label: formatSavedModelDisplayName(
            providerDisplayName,
            model.modelName,
          ),
          subtitle: duplicate ? model.vendorModelId : undefined,
        };
      });
      collected.sort((a, b) => a.label.localeCompare(b.label));
      setRows(collected);
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => setRows([]));
    }
  }, [visible, reload]);

  const select = useCallback(
    async (savedModelId: string) => {
      // 分流：session 写 modelId patch（保持现有 mode/agentId），workspace 写全局。
      if (sessionId != null) {
        await runtime.sessions.updateSessionAgentConfig(sessionId, {
          modelId: savedModelId,
        });
      } else {
        await runtime.state.setCurrentModelId(savedModelId);
      }
      onSelected?.(savedModelId);
      onClose();
    },
    [runtime, sessionId, onSelected, onClose],
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
