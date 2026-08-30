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
import {FetchModelsSheet} from '../../components/provider/FetchModelsSheet';
import {
  ProviderForm,
  providerFormToEditPatch,
  type ProviderFormValues,
} from '../../components/provider/ProviderForm';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui/Buttons';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useBatchDeleteConfirm} from '../../hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '../../hooks/useFocusListReload';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {listScreenStyles} from '../shared/list-screen-styles';
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

  // 默认「模型管理」（高频），与「服务商配置」tab 并列；顶部 SegmentedControl 切换。
  const [activeTab, setActiveTab] = useState<'config' | 'models'>('config');

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

  // rows/loading/reload + 聚焦重载走共用 hook；加载失败渲染错误文案 + 重试。
  const {rows, loading, error, reload} = useFocusListReload<ModelRow[]>({
    fetcher: useCallback(async () => {
      if (!providerId) {
        // 缺路由参数：空态兑底（fetcher 返回 null 由 hook 落到 fallbackValue）
        return null;
      }
      const provider = await runtime.providers.get(providerId);
      setStackOverride({title: provider.displayName});
      const saved = await runtime.providerModels.savedList(providerId);
      const nameCounts = new Map<string, number>();
      for (const model of saved) {
        const key = modelNameKey(model.providerId, model.modelName);
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      return saved.map(model => {
        const sampling = savedModelSampling(model.settings);
        const hasSampling = Boolean(
          sampling.enabled && sampling.params,
        );
        const duplicate =
          (nameCounts.get(modelNameKey(model.providerId, model.modelName)) ??
            0) > 1;
        const label = formatSavedModelDisplayName(
          provider.displayName,
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
    }, [runtime, providerId, setStackOverride]),
    fallbackValue: EMPTY_ROWS,
  });

  // 失焦时清掉栈顶标题覆盖（重载本身已交给 useFocusListReload）。
  useFocusEffect(
    useCallback(() => {
      return () => setStackOverride(undefined);
    }, [setStackOverride]),
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

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除模型',
    message: ids => `确定删除选中的 ${ids.length} 个模型？`,
    deleteOne: useCallback(
      async (savedModelId: string) => {
        await runtime.providerModels.deleteSaved(savedModelId);
      },
      [runtime],
    ),
    onDone: async () => {
      await reload();
      batch.exit();
    },
  });

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
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <SegmentedControl
        tokens={tokens}
        value={activeTab}
        onChange={value => setActiveTab(value)}
        options={[
          {value: 'config', label: '服务商配置'},
          {value: 'models', label: '模型管理'},
        ]}
      />
      {activeTab === 'config' ? (
        providerId ? (
          <ProviderConfigTab providerId={providerId} />
        ) : (
          <Text style={[styles.empty, {color: tokens.textSecondary}]}>
            缺少 providerId
          </Text>
        )
      ) : (
        <>
      <ManageHeader
        title="已保存模型"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        allSelected={rows.length > 0 && batch.selectedCount === rows.length}
        onSelectAll={() =>
          batch.selectRange(
            batch.selectedCount === rows.length
              ? []
              : rows.map(row => row.savedModelId),
          )
        }
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
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
        <ActivityIndicator style={listScreenStyles.loader} />
      ) : error ? (
        <View style={styles.errorWrap}>
          <Text style={[styles.errorText, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.savedModelId}
          contentContainerStyle={listScreenStyles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void reload()} />
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
      <TextPromptModal
        visible={addVisible}
        variant="bottom"
        title="添加模型"
        confirmLabel="添加"
        fields={[
          {
            label: '厂商模型 ID',
            placeholder: '如 gpt-4o',
            autoCapitalize: 'none',
          },
          {label: '模型名称（可选）', placeholder: '模型名称', optional: true},
        ]}
        onClose={() => setAddVisible(false)}
        onConfirm={values => handleAdd(values[0], values[1] || undefined)}
      />
      <TextPromptModal
        visible={renameVisible}
        variant="bottom"
        title="重命名模型"
        label="模型名称"
        placeholder="模型名称"
        initialValue={renameModelName}
        autoCapitalize="none"
        confirmLabel="保存"
        onClose={() => {
          setRenameVisible(false);
          setMenuSavedModelId(undefined);
        }}
        onConfirm={values => handleRename(values[0])}
      />
      {providerId ? (
        <FetchModelsSheet
          visible={fetchVisible}
          providerId={providerId}
          onClose={() => setFetchVisible(false)}
          onSaved={() => void reload()}
        />
      ) : null}
      <BottomSheetMenu
        visible={menuSavedModelId != null}
        items={[
          {label: '重命名', action: 'rename'},
          {label: '删除', action: 'delete', danger: true},
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
        </>
      )}
    </View>
  );
}

/**
 * 服务商配置 tab：内嵌原 ProviderEditScreen 的加载/保存逻辑。
 * 从 ProviderDetailScreen 接收 providerId（不再走 navigation route），
 * 保存后不 goBack（现在在 tab 内，不能跳走），只 toast。
 */
function ProviderConfigTab({providerId}: {providerId: string}) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initial, setInitial] = useState<Partial<ProviderFormValues>>();
  const [isBuiltin, setIsBuiltin] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'set' | 'not set'>('not set');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const provider = await runtime.providers.get(providerId);
      const listed = (await runtime.providers.list()).find(
        p => p.id === providerId,
      );
      setIsBuiltin(provider.isBuiltin);
      setApiKeyStatus(listed?.apiKeyStatus ?? 'not set');
      setInitial({
        displayName: provider.displayName,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        headersJson:
          Object.keys(provider.headers).length > 0
            ? JSON.stringify(provider.headers)
            : '',
        apiKey: '',
      });
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (loading || !initial) {
    return (
      <View style={styles.configRoot}>
        <ActivityIndicator style={listScreenStyles.loader} />
      </View>
    );
  }

  return (
    <View style={[styles.configRoot, {backgroundColor: tokens.background}]}>
      {isBuiltin ? (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          内置服务商不可修改协议。
        </Text>
      ) : null}
      <ProviderForm
        mode="edit"
        initial={initial}
        isBuiltin={isBuiltin}
        apiKeyStatus={apiKeyStatus}
        saving={saving}
        onSubmit={async values => {
          setSaving(true);
          try {
            const patch = providerFormToEditPatch(values);
            if (!isBuiltin && values.protocol !== initial.protocol) {
              await runtime.providers.edit(providerId, {
                ...patch,
                protocol: values.protocol,
              });
            } else {
              await runtime.providers.edit(providerId, patch);
            }
            showToast('已保存');
            // tab 内不 goBack，重新拉取以反映 protocol 等不可变字段的现状
            await load();
          } catch (err) {
            showToast(toastMessage('保存失败', err));
          } finally {
            setSaving(false);
          }
        }}
      />
    </View>
  );
}

const EMPTY_ROWS: ModelRow[] = [];

const styles = StyleSheet.create({
  configRoot: {flex: 1, paddingHorizontal: 16},
  hint: {paddingTop: 12, fontSize: 13},
  errorWrap: {alignItems: 'center', gap: 12, padding: 24},
  errorText: {textAlign: 'center', lineHeight: 20},
  emptyWrap: {alignItems: 'center', padding: 32, gap: 16},
  empty: {textAlign: 'center'},
  modelIcon: {fontSize: 22},
});
