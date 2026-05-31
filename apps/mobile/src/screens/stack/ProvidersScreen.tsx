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
import {formatApplicationModelId} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface ProviderRow extends ProviderListItem {
  savedCount: number;
  samplingCount: number;
}

export function ProvidersScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuProviderId, setMenuProviderId] = useState<string | undefined>();
  const batch = useBatchSelection();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const providers = await runtime.providers.list();
      const enriched: ProviderRow[] = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        let samplingCount = 0;
        for (const model of saved) {
          const applicationModelId = formatApplicationModelId(
            provider.id,
            model.vendorModelId,
          );
          const profile =
            await runtime.modelSamplingProfiles.getProfile(applicationModelId);
          if (profile?.enabled && profile.params) {
            samplingCount += 1;
          }
        }
        enriched.push({
          ...provider,
          savedCount: saved.length,
          samplingCount,
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

  const metaLine = (row: ProviderRow) => {
    let meta = `${row.savedCount} 个已保存模型 · apiKey: ${row.apiKeyStatus}`;
    if (row.samplingCount > 0) {
      meta += ` · ${row.samplingCount} 个已配采样`;
    }
    return meta;
  };

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
                Alert.alert('已删除服务商');
              })
              .catch(err =>
                Alert.alert(
                  '删除失败',
                  err instanceof Error ? err.message : String(err),
                ),
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
              Alert.alert('已删除服务商');
            })().catch(err =>
              Alert.alert(
                '删除失败',
                err instanceof Error ? err.message : String(err),
              ),
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
          <Pressable
            style={[styles.addBtn, {backgroundColor: tokens.primary}]}
            onPress={() => navigation.navigate('ProviderCreate')}>
            <Text style={styles.addBtnText}>添加</Text>
          </Pressable>
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无服务商，点击「添加服务商」创建。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.id);
                } else {
                  navigation.navigate('ProviderDetail', {providerId: item.id});
                }
              }}>
              {batch.active ? (
                <BatchCheckbox
                  checked={batch.isSelected(item.id)}
                  onToggle={() => batch.toggle(item.id)}
                />
              ) : (
                <Text style={styles.icon}>🟢</Text>
              )}
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.displayName?.trim() || item.id}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {metaLine(item)}
                </Text>
              </View>
              {!batch.active ? (
                <>
                  <Pressable
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation?.();
                      setMenuProviderId(item.id);
                    }}>
                    <Text style={{color: tokens.textSecondary, fontSize: 18}}>
                      ⋮
                    </Text>
                  </Pressable>
                  <Text style={{color: tokens.textSecondary}}>›</Text>
                </>
              ) : null}
            </Pressable>
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
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: {color: '#fff', fontWeight: '600'},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  icon: {fontSize: 20},
  info: {flex: 1, gap: 2},
  name: {fontSize: 16, fontWeight: '500'},
  meta: {fontSize: 13},
});
