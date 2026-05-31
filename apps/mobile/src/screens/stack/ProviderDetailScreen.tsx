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
import {FetchModelsSheet} from '../../components/provider/FetchModelsSheet';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {resolveModelShortLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

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
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const providerId = route.params?.providerId;
  const {setStackOverride} = useHeaderContext();

  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [fetchVisible, setFetchVisible] = useState(false);
  const [menuVendorId, setMenuVendorId] = useState<string | undefined>();
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
          label = await resolveModelShortLabel(runtime, applicationModelId);
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
      showToast(toastMessage('加载失败', error));
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
      showToast(toastMessage('错误', '缺少 providerId'));
      navigation.goBack();
    }
  }, [providerId, navigation, showToast]);

  const handleAdd = async (vendorModelId: string, displayName?: string) => {
    if (!providerId) {
      return;
    }
    await runtime.providerModels.save(providerId, vendorModelId, displayName);
    await reload();
    showToast('已添加模型');
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
            })
            .catch(err =>
              showToast(toastMessage('删除失败', err)),
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
          deleteModels([vendorModelId]).catch(err =>
            showToast(toastMessage('删除失败', err)),
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
            <SecondaryButton
              label="远程"
              tokens={tokens}
              onPress={() => setFetchVisible(true)}
            />
            <PrimaryButton
              label="添加"
              tokens={tokens}
              onPress={() => setAddVisible(true)}
            />
          </>
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.vendorModelId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                暂无已保存模型
              </Text>
            </View>
          }
          renderItem={({item}) => (
            <ConfigListCard
              tokens={tokens}
              selected={batch.isSelected(item.vendorModelId)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.vendorModelId);
                } else {
                  navigation.navigate('ModelSampling', {
                    applicationModelId: item.applicationModelId,
                  });
                }
              }}
              leading={
                batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(item.vendorModelId)}
                    onToggle={() => batch.toggle(item.vendorModelId)}
                  />
                ) : (
                  <Text style={styles.modelIcon}>🧠</Text>
                )
              }
              title={item.label}
              subtitle={`${item.applicationModelId}${item.hasSampling ? ' · 已配采样' : ''}`}
              onMenuPress={
                batch.active
                  ? undefined
                  : () => setMenuVendorId(item.vendorModelId)
              }
            />
          )}
        />
      )}
      <AddModelModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onConfirm={handleAdd}
      />
      {providerId ? (
        <FetchModelsSheet
          visible={fetchVisible}
          providerId={providerId}
          savedVendorIds={rows.map(r => r.vendorModelId)}
          onClose={() => setFetchVisible(false)}
          onSaved={() => reload().catch(() => undefined)}
        />
      ) : null}
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
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  emptyWrap: {alignItems: 'center', padding: 32, gap: 16},
  empty: {textAlign: 'center'},
  modelIcon: {fontSize: 22},
});
