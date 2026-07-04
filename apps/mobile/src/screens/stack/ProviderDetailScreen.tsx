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
import {
  formatSavedModelDisplayName,
  savedModelSampling,
} from '@novel-master/core/provider';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {AddModelModal} from '../../components/provider/AddModelModal';
import {EditModelNameModal} from '../../components/provider/EditModelNameModal';
import {FetchModelsSheet} from '../../components/provider/FetchModelsSheet';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'ProviderDetail'>;

interface ModelRow {
  savedModelId: string;
  vendorModelId: string;
  modelName: string;
  label: string;
  subtitle: string;
  hasSampling: boolean;
}

function modelNameKey(providerId: string, modelName: string): string {
  return `${providerId}\0${modelName}`;
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
  const [menuSavedModelId, setMenuSavedModelId] = useState<string | undefined>();
  const [renameModelName, setRenameModelName] = useState('');
  const [renameVisible, setRenameVisible] = useState(false);
  const batch = useBatchSelection();

  const dismissAllOverlays = useCallback(() => {
    setAddVisible(false);
    setFetchVisible(false);
    setMenuSavedModelId(undefined);
    setRenameVisible(false);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const reload = useCallback(async () => {
    if (!providerId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const provider = await runtime.providers.get(providerId);
      setStackOverride({title: provider.id});
      const saved = await runtime.providerModels.savedList(providerId);
      const nameCounts = new Map<string, number>();
      for (const model of saved) {
        const key = modelNameKey(model.providerId, model.modelName);
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const enriched: ModelRow[] = saved.map(model => {
        const sampling = savedModelSampling(model.settings);
        const hasSampling = Boolean(
          sampling.enabled && sampling.params,
        );
        const duplicate =
          (nameCounts.get(modelNameKey(model.providerId, model.modelName)) ??
            0) > 1;
        const label = formatSavedModelDisplayName(
          model.providerId,
          model.modelName,
        );
        const subtitleParts = [
          duplicate ? model.vendorModelId : undefined,
          hasSampling ? '已配采样' : undefined,
        ].filter(Boolean);
        return {
          savedModelId: model.id,
          vendorModelId: model.vendorModelId,
          modelName: model.modelName,
          label,
          subtitle: subtitleParts.join(' · '),
          hasSampling,
        };
      });
      setRows(enriched);
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId, setStackOverride, showToast]);

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

  const handleAdd = async (vendorModelId: string, modelName?: string) => {
    if (!providerId) {
      return;
    }
    await runtime.providerModels.save(providerId, vendorModelId, modelName);
    await reload();
    showToast('已添加模型');
  };

  const deleteModels = async (savedModelIds: string[]) => {
    for (const savedModelId of savedModelIds) {
      await runtime.providerModels.deleteSaved(savedModelId);
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

  const handleDelete = async (row: ModelRow) => {
    Alert.alert('删除模型', `确定删除 ${row.label}？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteModels([row.savedModelId]).catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const handleRename = async (modelName: string) => {
    if (!menuSavedModelId) {
      return;
    }
    try {
      await runtime.providerModels.editSaved(menuSavedModelId, modelName);
      await reload();
      showToast('已重命名模型');
      setMenuSavedModelId(undefined);
    } catch (error) {
      showToast(toastMessage('重命名失败', error));
      throw error;
    }
  };

  const menuRow = rows.find(r => r.savedModelId === menuSavedModelId);

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
          keyExtractor={item => item.savedModelId}
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
              selected={batch.isSelected(item.savedModelId)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.savedModelId);
                } else {
                  navigation.navigate('ModelSampling', {
                    savedModelId: item.savedModelId,
                  });
                }
              }}
              leading={
                batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(item.savedModelId)}
                    onToggle={() => batch.toggle(item.savedModelId)}
                  />
                ) : (
                  <Text style={styles.modelIcon}>🧠</Text>
                )
              }
              title={item.label}
              subtitle={item.subtitle || undefined}
              onMenuPress={
                batch.active
                  ? undefined
                  : () => setMenuSavedModelId(item.savedModelId)
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
      <EditModelNameModal
        visible={renameVisible}
        initialModelName={renameModelName}
        onClose={() => {
          setRenameVisible(false);
          setMenuSavedModelId(undefined);
        }}
        onConfirm={handleRename}
      />
      {providerId ? (
        <FetchModelsSheet
          visible={fetchVisible}
          providerId={providerId}
          onClose={() => setFetchVisible(false)}
          onSaved={() => reload().catch(() => undefined)}
        />
      ) : null}
      <BottomSheetMenu
        visible={menuSavedModelId != null}
        items={[
          {label: '重命名', action: 'rename'},
          {label: '删除模型', action: 'delete', danger: true},
        ]}
        onClose={() => setMenuSavedModelId(undefined)}
        onSelect={action => {
          const row = menuRow;
          if (action === 'rename' && row) {
            setRenameModelName(row.modelName);
            setRenameVisible(true);
          } else if (action === 'delete' && row) {
            setMenuSavedModelId(undefined);
            handleDelete(row).catch(() => undefined);
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
