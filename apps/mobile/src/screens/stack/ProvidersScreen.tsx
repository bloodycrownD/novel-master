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
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ProviderListItem} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
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
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuProviderId, setMenuProviderId] = useState<string | undefined>();
  const batch = useBatchSelection();

  const dismissAllOverlays = useCallback(() => {
    setMenuProviderId(undefined);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const providers = await runtime.providers.list();
      const enriched: ProviderRow[] = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        enriched.push({
          ...provider,
          savedCount: saved.length,
        });
      }
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => setRows([]));
    }, [reload]),
  );

  const metaLine = (row: ProviderRow) =>
    `${row.savedCount} 个已保存模型 · apiKey: ${row.apiKeyStatus}`;

  const deleteProviders = async (providerIds: string[]) => {
    for (const providerId of providerIds) {
      await runtime.providers.delete(providerId);
      const currentProviderId = await runtime.state.getCurrentProviderId();
      if (currentProviderId === providerId) {
        await runtime.state.resetCurrentProviderId();
      }
      const currentModelId = await runtime.state.getCurrentModelId();
      if (currentModelId?.startsWith(`${providerId}/`)) {
        await runtime.state.resetCurrentModelId();
      }
    }
    await reload();
  };

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert(
      '删除服务商',
      `将同时移除其下所有已保存模型，确定删除选中的 ${ids.length} 个服务商？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            deleteProviders(ids)
              .then(() => {
                batch.exit();
              })
              .catch(err =>
                showToast(toastMessage('删除失败', err)),
              );
          },
        },
      ],
    );
  };

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
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="服务商"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
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
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无服务商，点击「添加服务商」创建。
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
              title={item.id}
              subtitle={metaLine(item)}
              onMenuPress={
                batch.active ? undefined : () => setMenuProviderId(item.id)
              }
            />
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuProviderId != null}
        items={[
          {label: '编辑', action: 'edit'},
          {label: '删除', action: 'delete', danger: true},
        ]}
        onClose={() => setMenuProviderId(undefined)}
        onSelect={action => {
          const id = menuProviderId;
          setMenuProviderId(undefined);
          if (!id) {
            return;
          }
          if (action === 'edit') {
            navigation.navigate('ProviderEdit', {providerId: id});
          } else if (action === 'delete') {
            handleDelete(id);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
  icon: {fontSize: 22},
});
