/**
 * Saved models for one provider; add model + navigate to sampling.
 */
import React, {useCallback, useEffect, useState} from 'react';
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
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {formatApplicationModelId} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {AddModelModal} from '../../components/provider/AddModelModal';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'ProviderDetail'>;

interface ModelRow {
  vendorModelId: string;
  applicationModelId: string;
  label: string;
  hasSampling: boolean;
}

export function ProviderDetailScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const providerId = route.params?.providerId;
  const {setStackOverride} = useHeaderContext();

  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [menuVendorId, setMenuVendorId] = useState<string | undefined>();
  const [fetching, setFetching] = useState(false);
  const batch = useBatchSelection();

  const reload = useCallback(async () => {
    if (!providerId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const provider = await runtime.providers.get(providerId);
      setStackOverride({title: provider.displayName?.trim() || provider.id});
      const saved = await runtime.providerModels.savedList(providerId);
      const enriched: ModelRow[] = [];
      for (const model of saved) {
        const applicationModelId = formatApplicationModelId(
          providerId,
          model.vendorModelId,
        );
        const profile =
          await runtime.modelSamplingProfiles.getProfile(applicationModelId);
        const hasSampling = Boolean(profile?.enabled && profile.params);
        let label = model.displayName?.trim() || model.vendorModelId;
        try {
          label = await resolveModelDisplayLabel(runtime, applicationModelId);
        } catch {
          /* fallback */
        }
        enriched.push({
          vendorModelId: model.vendorModelId,
          applicationModelId,
          label,
          hasSampling,
        });
      }
      setRows(enriched);
    } catch (error) {
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId, setStackOverride]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      return () => setStackOverride(undefined);
    }, [reload, setStackOverride]),
  );

  useEffect(() => {
    if (!providerId) {
      Alert.alert('错误', '缺少 providerId', [
        {text: '返回', onPress: () => navigation.goBack()},
      ]);
    }
  }, [providerId, navigation]);

  const handleAdd = async (vendorModelId: string, displayName?: string) => {
    if (!providerId) {
      return;
    }
    await runtime.providerModels.save(providerId, vendorModelId, displayName);
    await reload();
    Alert.alert('已添加模型');
  };

  const handleFetchModels = async () => {
    if (!providerId || fetching) {
      return;
    }
    setFetching(true);
    try {
      await runtime.providerModels.fetch(providerId);
      Alert.alert('已拉取模型列表', '可在添加模型时从建议列表选择。');
    } catch (error) {
      Alert.alert(
        '拉取失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setFetching(false);
    }
  };

  const deleteModels = async (vendorModelIds: string[]) => {
    if (!providerId) {
      return;
    }
    for (const vendorModelId of vendorModelIds) {
      const applicationModelId = formatApplicationModelId(
        providerId,
        vendorModelId,
      );
      await runtime.providerModels.deleteSaved(providerId, vendorModelId);
      await runtime.modelSamplingProfiles.clearProfile(applicationModelId);
    }
    await reload();
  };

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除模型', `确定删除选中的 ${ids.length} 个模型？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteModels(ids)
            .then(() => {
              batch.exit();
              Alert.alert('已删除模型');
            })
            .catch(err =>
              Alert.alert(
                '删除失败',
                err instanceof Error ? err.message : String(err),
              ),
            );
        },
      },
    ]);
  };

  const handleDelete = async (vendorModelId: string) => {
    if (!providerId) {
      return;
    }
    const applicationModelId = formatApplicationModelId(
      providerId,
      vendorModelId,
    );
    Alert.alert('删除模型', `确定删除 ${applicationModelId}？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteModels([vendorModelId])
            .then(() => Alert.alert('已删除模型'))
            .catch(err =>
            Alert.alert(
              '删除失败',
              err instanceof Error ? err.message : String(err),
            ),
          );
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="已保存模型"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
        hint="选择要删除的模型（批量模式下不会进入采样配置）"
        normalActions={
          <>
            <Pressable
              style={[styles.secondaryBtn, {borderColor: tokens.border}]}
              disabled={fetching}
              onPress={() => handleFetchModels().catch(() => undefined)}>
              {fetching ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={{color: tokens.text, fontWeight: '600'}}>
                  拉取
                </Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.addBtn, {backgroundColor: tokens.primary}]}
              onPress={() => setAddVisible(true)}>
              <Text style={styles.addBtnText}>添加</Text>
            </Pressable>
          </>
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.vendorModelId}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无已保存模型，点击「拉取模型」或「添加模型」。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.vendorModelId);
                } else {
                  navigation.navigate('ModelSampling', {
                    applicationModelId: item.applicationModelId,
                  });
                }
              }}>
              {batch.active ? (
                <BatchCheckbox
                  checked={batch.isSelected(item.vendorModelId)}
                  onToggle={() => batch.toggle(item.vendorModelId)}
                />
              ) : null}
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.label}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {item.applicationModelId}
                  {item.hasSampling ? ' · 已配采样' : ''}
                </Text>
              </View>
              {!batch.active ? (
                <>
                  <Pressable
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation?.();
                      setMenuVendorId(item.vendorModelId);
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
      <AddModelModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onConfirm={handleAdd}
      />
      <BottomSheetMenu
        visible={menuVendorId != null}
        items={[{label: '删除模型', action: 'delete', danger: true}]}
        onClose={() => setMenuVendorId(undefined)}
        onSelect={action => {
          if (action === 'delete' && menuVendorId) {
            handleDelete(menuVendorId).catch(() => undefined);
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
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 72,
    alignItems: 'center',
  },
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  info: {flex: 1, gap: 2},
  name: {fontSize: 16, fontWeight: '500'},
  meta: {fontSize: 12},
});
