/**
 * Provider list → detail navigation.
 */
import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {type ProviderListItem} from '@novel-master/core/provider';
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
import {Result, AppError} from '@novel-master/core/errors';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';

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
            const listed = await runtime.providers.list();
            // nm-throw: keep — fetcher 槽位契约：抛错由 useFocusListReload 收进 error 态（配重试）
            if (!listed.ok) throw listed.error;
            const providers = listed.value;
            const enriched: ProviderRow[] = [];
            for (const provider of providers) {
                const saved = await runtime.providerModels.savedList(provider.id);
                // nm-throw: keep — fetcher 槽位契约：同上，收进 hook error 态
                if (!saved.ok) throw saved.error;
                enriched.push({
                    ...provider,
                    savedCount: saved.value.length,
                });
            }
            return enriched;
        }, [runtime]),
        fallbackValue: EMPTY_ROWS,
    });

    const metaLine = (row: ProviderRow) => coreT({key: "ui.provider.models_saved_meta", params: {count: row.savedCount}});

    // 删除单个服务商：级联清掉「当前服务商/模型」的指向，避免悬空引用。
    // ⚠️ currentModelId 的归属判定必须在 providers.delete 之前完成——delete 会级联抹掉
    // 该服务商名下的全部已保存模型行，之后再 getSavedById 恒为 null，reset 永不执行，
    // currentModelId 就会悬空固化进新会话的 agent_config_json，发消息时才抛
    // INVALID_SAVED_MODEL_ID 且 UI 零解释。这是 core `DefaultProviderService.delete`
    // 把 currentModelId 当软指针（不参与 SAVED_MODEL_IN_USE 前置拒绝）的另一半契约，
    // cli / desktop / mobile 三调用方必须一致，改任一方须同步复核另外两方。
    const deleteProviderOne = useCallback(
        async (providerId: string): Promise<Result<void, AppError>> => {
            const currentModel = await runtime.state.getCurrentModelId();
            if (!currentModel.ok) return Result.err(currentModel.error);
            const currentModelId = currentModel.value;
            let clearCurrentModel = false;
            if (currentModelId) {
                const saved = await runtime.providerModels.getSavedById(currentModelId);
                if (!saved.ok) return Result.err(saved.error);
                clearCurrentModel = saved.value?.providerId === providerId;
            }
            const deleted = await runtime.providers.delete(providerId);
            if (!deleted.ok) return deleted;
            const currentProvider = await runtime.state.getCurrentProviderId();
            if (!currentProvider.ok) return Result.err(currentProvider.error);
            if (currentProvider.value === providerId) {
                await runtime.state.resetCurrentProviderId();
            }
            if (clearCurrentModel) {
                await runtime.state.resetCurrentModelId();
            }
            return Result.ok(undefined);
        },
        [runtime],
    );

    const deleteProviders = async (providerIds: string[]) => {
        for (const providerId of providerIds) {
            const deleted = await deleteProviderOne(providerId);
            if (!deleted.ok) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), deleted.error));
                return;
            }
        }
        await reload();
    };

    const confirmBatchDelete = useBatchDeleteConfirm<string>({
        title: coreT({key: "ui.provider.delete_title"}),
        message: ids => coreT({key: "ui.provider.delete_batch_confirm", params: {count: ids.length}}),
        deleteOne: deleteProviderOne,
        onDone: async () => {
            await reload();
            batch.exit();
        },
    });

    const handleDelete = (providerId: string) => {
        Alert.alert(coreT({key: "ui.provider.delete_title"}), coreT({key: "ui.provider.delete_confirm_msg"}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.delete"}),
                style: 'destructive',
                onPress: () => {
                    (async () => {
                        await deleteProviders([providerId]);
                    })().catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err)));
                },
            },
        ]);
    };

    // 首载转圈 / 失败给重试 / 就绪渲染列表
    let bodyNode: React.ReactNode;
    if (loading && rows.length === 0) {
        bodyNode = <ActivityIndicator style={listScreenStyles.loader} />;
    } else if (error) {
        bodyNode = (
            <View style={styles.center}>
                <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
                <Pressable onPress={() => void reload()}>
                    <Text style={{color: tokens.primary, fontWeight: '600'}}>{coreT({key: "ui.common.retry"})}</Text>
                </Pressable>
            </View>
        );
    } else {
        bodyNode = (
            <FlatList
                data={rows}
                    keyExtractor={item => item.id}
                    contentContainerStyle={listScreenStyles.listContent}
                    refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
                    ListEmptyComponent={<Text style={[listScreenStyles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.provider.empty_hint"})}</Text>}
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
                            leading={batch.active ? <BatchCheckbox checked={batch.isSelected(item.id)} onToggle={() => batch.toggle(item.id)} /> : <Text style={styles.icon}>🟢</Text>}
                            title={item.displayName}
                            subtitle={metaLine(item)}
                            trailingMeta={<ApiKeyStatusTag status={item.apiKeyStatus} tokens={tokens} />}
                            onMenuPress={batch.active ? undefined : () => setMenuProviderId(item.id)}
                        />
                    )}
                />
        );
    }

    return (
        <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
            <ManageHeader
                title={coreT({key: "ui.provider.title"})}
                batchMode={batch.active}
                selectedCount={batch.selectedCount}
                onEnterBatch={batch.enter}
                onCancelBatch={batch.exit}
                onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
                hint={coreT({key: "ui.provider.delete_select_hint_mobile"})}
                normalActions={<PrimaryButton label={coreT({key: "ui.common.add"})} tokens={tokens} onPress={() => navigation.navigate('ProviderCreate')} />}
            />
            {bodyNode}
            <BottomSheetMenu
                visible={menuProviderId != null}
                items={[{label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true}]}
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
