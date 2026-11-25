/**
 * Saved models for one provider; add model + navigate to sampling.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {SavedModelDisplayName, SavedModelSettings} from '@novel-master/core/provider';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {FetchModelsSheet} from '../../components/provider/FetchModelsSheet';
import {ProviderForm, ProviderFormMapper, type ProviderFormValues} from '../../components/provider/ProviderForm';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {PrimaryButton, SecondaryButton} from '../../components/ui/Buttons';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useBatchDeleteConfirm} from '../../hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '../../hooks/useFocusListReload';
import {useRuntime} from '../../hooks/useRuntime';
import {useStackOverrideSetter} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useToast} from '../../components/chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';
import {ModelKey} from '../../utils/model-key';

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

export function ProviderDetailScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const navigation = useNavigation<Nav>();
    const route = useRoute<DetailRoute>();
    const providerId = route.params?.providerId;
    // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
    const setStackOverride = useStackOverrideSetter();

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
            const got = await runtime.providers.get(providerId);
            // nm-throw: keep — fetcher 槽位契约：抛错由 useFocusListReload 收进 error 态（配重试）
            if (!got.ok) throw got.error;
            const provider = got.value;
            setStackOverride({title: provider.displayName});
            const saved = await runtime.providerModels.savedList(providerId);
            // nm-throw: keep — fetcher 槽位契约：同上，收进 hook error 态
            if (!saved.ok) throw saved.error;
            const nameCounts = new Map<string, number>();
            for (const model of saved.value) {
                const key = ModelKey.name(model.providerId, model.modelName);
                nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
            }
            return saved.value.map(model => {
                const sampling = SavedModelSettings.sampling(model.settings);
                const hasSampling = Boolean(sampling.enabled && sampling.params);
                const duplicate = (nameCounts.get(ModelKey.name(model.providerId, model.modelName)) ?? 0) > 1;
                const label = SavedModelDisplayName.format(provider.displayName, model.modelName);
                const subtitleParts = [duplicate ? model.vendorModelId : undefined, hasSampling ? coreT({key: "ui.provider.sampling_badge"}) : undefined].filter(Boolean);
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
    const onScreenBlur = useCallback(() => {
        return () => setStackOverride(undefined);
    }, [setStackOverride]);
    useFocusEffect(onScreenBlur);

    useEffect(() => {
        if (!providerId) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.error"}), coreT({key: "ui.provider.provider_id_missing"})));
            navigation.goBack();
        }
    }, [providerId, navigation, showToast]);

    const handleAdd = async (vendorModelId: string, modelName?: string) => {
        if (!providerId) {
            return;
        }
        const savedModel = await runtime.providerModels.save(providerId, vendorModelId, modelName);
        // nm-throw: keep — UI 回调解包边界：失败位转 throw 交 TextPromptModal onConfirm 回调链收口（React 回调，调用方改不动）
        if (!savedModel.ok) throw savedModel.error;
        await reload();
        showToast(coreT({key: "ui.provider.models_added_done"}));
    };

    const deleteModels = async (savedModelIds: string[]) => {
        for (const savedModelId of savedModelIds) {
            const deleted = await runtime.providerModels.deleteSaved(savedModelId);
            // nm-throw: keep — UI 回调解包边界：失败位转 throw 交调用点 .catch toast（React 回调，调用方改不动）
            if (!deleted.ok) throw deleted.error;
        }
        await reload();
    };

    const confirmBatchDelete = useBatchDeleteConfirm<string>({
        title: coreT({key: "ui.provider.delete_model_title"}),
        message: ids => coreT({key: "ui.provider.delete_models_confirm", params: {count: ids.length}}),
        // 五期门⑦：deleteSaved 已知失败沿返回值到达，直接透传，不再走 try/catch 桥。
        deleteOne: useCallback(
            async (savedModelId: string) => {
                return runtime.providerModels.deleteSaved(savedModelId);
            },
            [runtime],
        ),
        onDone: async () => {
            await reload();
            batch.exit();
        },
    });

    const handleDelete = async (row: ModelRow) => {
        Alert.alert(coreT({key: "ui.provider.delete_model_title"}), coreT({key: "ui.common.delete_named_confirm", params: {name: row.label}}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.delete"}),
                style: 'destructive',
                onPress: () => {
                    deleteModels([row.savedModelId]).catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err)));
                },
            },
        ]);
    };

    const handleRename = async (modelName: string) => {
        if (!menuSavedModelId) {
            return;
        }
        try {
            const renamed = await runtime.providerModels.editSaved(menuSavedModelId, modelName);
            // nm-throw: keep — UI 回调解包边界：失败位转 throw 交本地 catch toast（React 回调，调用方改不动）
            if (!renamed.ok) throw renamed.error;
            await reload();
            showToast(coreT({key: "ui.provider.model_renamed_done"}));
            setMenuSavedModelId(undefined);
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.rename_failed"}), error));
            // nm-throw: keep — UI 回调解包边界：toast 后原样上抛交上层回调链收口（React 回调，调用方改不动）
            throw error;
        }
    };

    const menuRow = rows.find(r => r.savedModelId === menuSavedModelId);

    // 模型列表区：首载转圈 / 失败给重试 / 就绪渲染已存模型列表
    let modelsBody: React.ReactNode;
    if (loading && rows.length === 0) {
        modelsBody = <ActivityIndicator style={listScreenStyles.loader} />;
    } else if (error) {
        modelsBody = (
            <View style={styles.errorWrap}>
                <Text style={[styles.errorText, {color: tokens.danger}]}>{error}</Text>
                <Pressable onPress={() => void reload()}>
                    <Text style={{color: tokens.primary, fontWeight: '600'}}>{coreT({key: "ui.common.retry"})}</Text>
                </Pressable>
            </View>
        );
    } else {
        modelsBody = (
            <FlatList
                data={rows}
                keyExtractor={item => item.savedModelId}
                contentContainerStyle={listScreenStyles.listContent}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
                ListEmptyComponent={
                    <View style={styles.emptyWrap}>
                        <Text style={[styles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.provider.empty_saved_models"})}</Text>
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
                        leading={batch.active ? <BatchCheckbox checked={batch.isSelected(item.savedModelId)} onToggle={() => batch.toggle(item.savedModelId)} /> : <Text style={styles.modelIcon}>🧠</Text>}
                        title={item.label}
                        subtitle={item.subtitle || undefined}
                        onMenuPress={batch.active ? undefined : () => setMenuSavedModelId(item.savedModelId)}
                    />
                )}
            />
        );
    }

    // config tab 缺 providerId 提示缺失；models tab 渲染管理区（列表 + 弹窗组）
    let tabNode: React.ReactNode;
    if (activeTab === 'config') {
        if (providerId) {
            tabNode = <ProviderConfigTab providerId={providerId} />;
        } else {
            tabNode = <Text style={[styles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.provider.provider_id_missing"})}</Text>;
        }
    } else {
        tabNode = (
            <>
                <ManageHeader
                    title={coreT({key: "ui.provider.models_saved_done"})}
                    batchMode={batch.active}
                    selectedCount={batch.selectedCount}
                    allSelected={rows.length > 0 && batch.selectedCount === rows.length}
                    onSelectAll={() => batch.selectRange(batch.selectedCount === rows.length ? [] : rows.map(row => row.savedModelId))}
                    onEnterBatch={batch.enter}
                    onCancelBatch={batch.exit}
                    onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
                    hint={coreT({key: "ui.provider.delete_select_hint"})}
                    normalActions={
                        <>
                            <SecondaryButton label={coreT({key: "ui.provider.remote_tag"})} tokens={tokens} onPress={() => setFetchVisible(true)} />
                            <PrimaryButton label={coreT({key: "ui.common.add"})} tokens={tokens} onPress={() => setAddVisible(true)} />
                        </>
                    }
                />
                {modelsBody}
                <TextPromptModal
                    visible={addVisible}
                    variant="bottom"
                    title={coreT({key: "ui.provider.add_model_title"})}
                    confirmLabel={coreT({key: "ui.common.add"})}
                    fields={[
                        {
                            label: coreT({key: "ui.provider.vendor_model_id_label"}),
                            placeholder: coreT({key: "ui.provider.vendor_model_id_placeholder"}),
                            autoCapitalize: 'none',
                        },
                        {
                            label: coreT({key: "ui.provider.model_name_optional_label"}),
                            placeholder: coreT({key: "ui.common.model_name"}),
                            optional: true,
                        },
                    ]}
                    onClose={() => setAddVisible(false)}
                    onConfirm={values => handleAdd(values[0], values[1] || undefined)}
                />
                <TextPromptModal
                    visible={renameVisible}
                    variant="bottom"
                    title={coreT({key: "ui.provider.rename_model_title"})}
                    label={coreT({key: "ui.common.model_name"})}
                    placeholder={coreT({key: "ui.common.model_name"})}
                    initialValue={renameModelName}
                    autoCapitalize="none"
                    confirmLabel={coreT({key: "ui.common.save"})}
                    onClose={() => {
                        setRenameVisible(false);
                        setMenuSavedModelId(undefined);
                    }}
                    onConfirm={values => handleRename(values[0])}
                />
                {providerId ? <FetchModelsSheet visible={fetchVisible} providerId={providerId} onClose={() => setFetchVisible(false)} onSaved={() => void reload()} /> : null}
                <BottomSheetMenu
                    visible={menuSavedModelId != null}
                    items={[
                        {label: coreT({key: "ui.common.rename"}), action: 'rename'},
                        {label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true},
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
        );
    }

    return (
        <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
            <SegmentedControl
                tokens={tokens}
                value={activeTab}
                onChange={value => setActiveTab(value)}
                options={[
                    {value: 'config', label: coreT({key: "ui.nav.providers"})},
                    {value: 'models', label: coreT({key: "ui.nav.model_management"})},
                ]}
            />
            {tabNode}
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
            const got = await runtime.providers.get(providerId);
            // nm-throw: keep — UI 回调解包边界：失败位转 throw 交本地 catch 设错误态（React 回调，调用方改不动）
            if (!got.ok) throw got.error;
            const provider = got.value;
            const listed = await runtime.providers.list();
            // nm-throw: keep — UI 回调解包边界：同上，交本地 catch 设错误态
            if (!listed.ok) throw listed.error;
            const listedItem = listed.value.find(p => p.id === providerId);
            setIsBuiltin(provider.isBuiltin);
            setApiKeyStatus(listedItem?.apiKeyStatus ?? 'not set');
            setInitial({
                displayName: provider.displayName,
                protocol: provider.protocol,
                baseUrl: provider.baseUrl,
                headersJson: Object.keys(provider.headers).length > 0 ? JSON.stringify(provider.headers) : '',
                bodyParamsJson: Object.keys(provider.bodyParams ?? {}).length > 0 ? JSON.stringify(provider.bodyParams) : '',
                apiKey: '',
            });
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), error));
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
            {isBuiltin ? <Text style={[styles.hint, {color: tokens.textSecondary}]}>{coreT({key: "ui.provider.builtin_protocol_hint"})}</Text> : null}
            <ProviderForm
                mode="edit"
                initial={initial}
                isBuiltin={isBuiltin}
                apiKeyStatus={apiKeyStatus}
                saving={saving}
                onSubmit={async values => {
                    setSaving(true);
                    try {
                        const patch = ProviderFormMapper.toEditPatch(values);
                        const editInput = !isBuiltin && values.protocol !== initial.protocol ? {...patch, protocol: values.protocol} : patch;
                        const edited = await runtime.providers.edit(providerId, editInput);
                        if (!edited.ok) {
                            showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), edited.error));
                            return;
                        }
                        showToast(coreT({key: "ui.common.saved"}));
                        // tab 内不 goBack，重新拉取以反映 protocol 等不可变字段的现状
                        await load();
                    } catch (err) {
                        showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), err));
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
