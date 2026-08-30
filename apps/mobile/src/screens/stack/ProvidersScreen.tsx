/**
 * Provider list → detail navigation.
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import { type ProviderListItem } from "@novel-master/core/provider";
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {ApiKeyStatusTag} from '../../components/provider/ApiKeyStatusTag';
import {PrimaryButton} from '../../components/ui/Buttons';
import {useBatchDeleteConfirm} from '../../hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '../../hooks/useFocusListReload';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface ProviderRow extends ProviderListItem {
  savedCount: number;
}

export function ProvidersScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [menuProviderId, setMenuProviderId] = useState<string | undefined>();
  const batch = useBatchSelection();

  const dismissAllOverlays = useCallback(() => {
    setMenuProviderId(undefined);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  // rows/loading/reload + 聚焦重载走共用 hook；fetcher 抛错进 error 态（配重试）。
  const {rows, loading, error, reload} = useFocusListReload({
    fetcher: useCallback(async () => {
      const providers = await runtime.providers.list();
      const enriched: ProviderRow[] = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        enriched.push({
          ...provider,
          savedCount: saved.length,
        });
      }
      return enriched;
    }, [runtime]),
    fallbackValue: EMPTY_ROWS,
  });

  const metaLine = (row: ProviderRow) =>
    `${row.savedCount} 个已保存模型`;

  // 删除单个服务商：级联清掉「当前服务商/模型」的指向，避免悬空引用。
  const deleteProviderOne = useCallback(
    async (providerId: string) => {
      await runtime.providers.delete(providerId);
      const currentProviderId = await runtime.state.getCurrentProviderId();
      if (currentProviderId === providerId) {
        await runtime.state.resetCurrentProviderId();
      }
      const currentModelId = await runtime.state.getCurrentModelId();
      if (currentModelId) {
        const saved = await runtime.providerModels.getSavedById(currentModelId);
        if (saved?.providerId === providerId) {
          await runtime.state.resetCurrentModelId();
        }
      }
    },
    [runtime],
  );

  const deleteProviders = async (providerIds: string[]) => {
    for (const providerId of providerIds) {
      await deleteProviderOne(providerId);
    }
    await reload();
  };

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除服务商',
    message: ids =>
      `将同时移除其下所有已保存模型，确定删除选中的 ${ids.length} 个服务商？`,
    deleteOne: deleteProviderOne,
    onDone: async () => {
      await reload();
      batch.exit();
    },
  });

  const handleDelete = (providerId: string) => {
    Alert.alert(
      '删除服务商',
      '将同时移除其下所有已保存模型与采样配置，确定继续？',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            (async () => {
              await deleteProviders([providerId]);
            })().catch(err =>
              showToast(toastMessage('删除失败', err)),
            );
          },
        },
      ],
    );
  };

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="服务商"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
        hint="选择要删除的服务商（将同时移除其下所有已保存模型）"
        normalActions={
          <PrimaryButton
            label="添加"
            tokens={tokens}
            onPress={() => navigation.navigate('ProviderCreate')}
          />
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={listScreenStyles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={listScreenStyles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text
              style={[listScreenStyles.empty, {color: tokens.textSecondary}]}>
              暂无服务商，点击右上角「添加」创建。
            </Text>
          }
          renderItem={({item}) => (
            <ConfigListCard
              tokens={tokens}
              selected={batch.isSelected(item.id)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.id);
                } else {
                  navigation.navigate('ProviderDetail', {providerId: item.id});
                }
              }}
              leading={
                batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(item.id)}
                    onToggle={() => batch.toggle(item.id)}
                  />
                ) : (
                  <Text style={styles.icon}>🟢</Text>
                )
              }
              title={item.displayName}
              subtitle={metaLine(item)}
              trailingMeta={
                <ApiKeyStatusTag status={item.apiKeyStatus} tokens={tokens} />
              }
              onMenuPress={
                batch.active ? undefined : () => setMenuProviderId(item.id)
              }
            />
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuProviderId != null}
        items={[{label: '删除', action: 'delete', danger: true}]}
        onClose={() => setMenuProviderId(undefined)}
        onSelect={action => {
          const id = menuProviderId;
          setMenuProviderId(undefined);
          if (!id) {
            return;
          }
          if (action === 'delete') {
            handleDelete(id);
          }
        }}
      />
    </View>
  );
}

const EMPTY_ROWS: ProviderRow[] = [];

const styles = StyleSheet.create({
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  icon: {fontSize: 22},
});
