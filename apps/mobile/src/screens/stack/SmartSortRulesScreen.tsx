/**
 * Smart sort rule management: list + toggle + reorder + batch + YAML I/O
 * (spec smart-filename-sort Step 13; 调序走行菜单按钮——上移/下移/置顶/
 * 置底，拖拽方案已按设计定案 D8 移除).
 */
import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Switch, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {SmartSortRule} from '@novel-master/core/smart-sort-rule';
import {SerializationParseText, SerializationStringifyText} from '@novel-master/core';
import {Errors} from '@novel-master/core/common';
import {Result} from '@novel-master/core/errors';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {PrimaryButton, SecondaryButton} from '@/components/ui/Buttons';
import {useBatchDeleteConfirm} from '@/hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {YamlShared} from '@/services/yaml-shared';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SmartSortRulesScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const navigation = useNavigation<Nav>();
    const batch = useBatchSelection();
    /** 行 ⋮ 菜单锚定的规则。 */
    const [menuRule, setMenuRule] = useState<SmartSortRule | null>(null);
    /** 顶栏「更多」菜单（导入/导出/恢复默认）。 */
    const [moreMenuVisible, setMoreMenuVisible] = useState(false);

    const {rows, loading, reload, setRows} = useFocusListReload<SmartSortRule[]>({
        fetcher: useCallback(async () => {
            const list = await runtime.smartSortRule.listRules();
            return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
        }, [runtime]),
        fallbackValue: EMPTY_RULES,
        onError: useCallback(
            (cause: unknown) => {
                showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), cause));
            },
            [showToast],
        ),
    });

    const createRule = () => {
        navigation.navigate('SmartSortRuleEditor', {});
    };

    // ---- 行内操作（⋮ 菜单） ----

    const moveRule = useCallback(
        async (ruleId: string, to: 'up' | 'down' | 'top' | 'bottom') => {
            try {
                await runtime.smartSortRule.moveRule(ruleId, to);
                await reload({silent: true});
            } catch (error) {
                showToast(ToastMessage.toast(coreT({key: "ui.smart_sort.adjust_failed"}), error));
            }
        },
        [runtime, reload, showToast],
    );

    const deleteRuleWithConfirm = useCallback(
        (rule: SmartSortRule) => {
            Alert.alert(coreT({key: "ui.smart_sort.delete_title"}), coreT({key: "ui.smart_sort.delete_confirm_named", params: {name: rule.name}}), [
                {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                {
                    text: coreT({key: "ui.common.delete"}),
                    style: 'destructive',
                    onPress: () => {
                        (async () => {
                            await runtime.smartSortRule.deleteRule(rule.ruleId);
                            await reload({silent: true});
                        })().catch(error => showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), error)));
                    },
                },
            ]);
        },
        [runtime, reload, showToast],
    );

    const handleRowMenuSelect = useCallback(
        (action: string) => {
            const rule = menuRule;
            setMenuRule(null);
            if (!rule) {
                return;
            }
            switch (action) {
                case 'edit':
                    navigation.navigate('SmartSortRuleEditor', {ruleId: rule.ruleId});
                    break;
                case 'top':
                case 'up':
                case 'down':
                case 'bottom':
                    void moveRule(rule.ruleId, action);
                    break;
                case 'delete':
                    deleteRuleWithConfirm(rule);
                    break;
                default:
                    break;
            }
        },
        [menuRule, navigation, moveRule, deleteRuleWithConfirm],
    );

    // ---- 行内启停（乐观更新，失败回滚） ----

    const toggleEnabled = useCallback(
        (rule: SmartSortRule, next: boolean) => {
            setRows(prev => prev.map(r => (r.ruleId === rule.ruleId ? {...r, enabled: next} : r)));
            runtime.smartSortRule.setEnabled(rule.ruleId, next).catch(error => {
                setRows(prev => prev.map(r => (r.ruleId === rule.ruleId ? {...r, enabled: rule.enabled} : r)));
                showToast(ToastMessage.toast(coreT({key: "ui.common.op_failed"}), error));
            });
        },
        [runtime, setRows, showToast],
    );

    // ---- 批量 ----

    const confirmBatchDelete = useBatchDeleteConfirm<string>({
        title: coreT({key: "ui.smart_sort.delete_title"}),
        message: ids => coreT({key: "ui.smart_sort.delete_batch_confirm", params: {count: ids.length}}),
        deleteOne: useCallback(
            async (ruleId: string) => {
                // builtin- 由 service 整体拒绝；这里逐条走 deleteRule 保持部分成功语义。
                return runtime.smartSortRule.deleteRule(ruleId);
            },
            [runtime],
        ),
        onDone: async () => {
            batch.exit();
            await reload();
        },
    });

    const runBatchDelete = useCallback(() => {
        const ids = Array.from(batch.selectedIds);
        if (ids.some(id => SmartSortRule.isBuiltinId(id))) {
            showToast(coreT({key: "ui.smart_sort.builtin_delete_block_mobile"}));
            return;
        }
        confirmBatchDelete(ids);
    }, [batch.selectedIds, confirmBatchDelete, showToast]);

    const runBatchSetEnabled = useCallback(
        (enabled: boolean) => {
            const ids = Array.from(batch.selectedIds);
            if (ids.length === 0) {
                return;
            }
            const setEnabledPromise = runtime.smartSortRule.setEnabledBatch(ids, enabled);
            setEnabledPromise
                .then(async () => {
                    await reload({silent: true});
                })
                .catch(error => {
                    showToast(ToastMessage.toast(coreT({key: "ui.common.op_failed"}), error));
                });
        },
        [batch.selectedIds, runtime, reload, showToast],
    );

    // ---- YAML 导入导出 / 恢复默认 ----

    const handleMoreSelect = useCallback(
        (action: string) => {
            setMoreMenuVisible(false);
            switch (action) {
                case 'import':
                    Alert.alert(coreT({key: "ui.smart_sort.import_title"}), coreT({key: "ui.smart_sort.import_confirm"}), [
                        {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                        {
                            text: coreT({key: "ui.common.import"}),
                            onPress: () => {
                                // 替换式导入（spec D10）：schema/decode 单源在 core
                                // `smart-sort-rule-io`；存储/事务类故障原样上抛、其余照旧套
                                // 「YAML 无效」前缀——判据与前缀都在 core 的
                                // `Errors.normalizeSmartSortImport` 里（desktop 侧调同一个函数）。
                                let importedCount: number | null = null;
                                YamlShared.importWithDialog(async yaml => {
                                    try {
                                        const raw = SerializationParseText.parse(yaml, 'yaml');
                                        const rules = await runtime.smartSortRule.importRules(raw);
                                        if (!rules.ok) return Result.err(Errors.normalizeSmartSortImport(rules.error));
                                        importedCount = rules.value.length;
                                        return Result.ok(undefined);
                                    } catch (error) {
                                        // 存储/事务类故障原样上抛、其余照旧套「YAML 无效」前缀——判据在 core。
                                        throw Errors.normalizeSmartSortImport(error);
                                    }
                                })
                                    .then(async imported => {
                                        if (!imported.ok) {
                                            showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), imported.error));
                                            return;
                                        }
                                        if (importedCount == null) {
                                            return;
                                        }
                                        await reload({silent: true});
                                        showToast(coreT({key: "ui.smart_sort.imported_count", params: {count: importedCount}}));
                                    })
                                    .catch(error => showToast(ToastMessage.toast(coreT({key: "ui.common.import_failed"}), error)));
                            },
                        },
                    ]);
                    break;
                case 'export':
                    // YAML 导出（spec smart-filename-sort Step 13 / D10）；文本序列化单源在 core。
                    runtime.smartSortRule
                        .exportRules()
                        .then(doc => YamlShared.exportWithDialog(SerializationStringifyText.stringify(doc, 'yaml'), 'smart-sort-rules.yaml'))
                        .then(result => {
                            if (result === 'saved') {
                                showToast(coreT({key: "ui.smart_sort.exported"}));
                            }
                        })
                        .catch(error => showToast(ToastMessage.toast(coreT({key: "ui.common.export_failed"}), error)));
                    break;
                case 'reset':
                    Alert.alert(coreT({key: "ui.common.reset_default"}), coreT({key: "ui.smart_sort.reset_confirm_mobile"}), [
                        {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                        {
                            text: coreT({key: "ui.common.restore"}),
                            onPress: () => {
                                runtime.smartSortRule
                                    .resetDefaults()
                                    .then(async () => {
                                        await reload({silent: true});
                                        showToast(coreT({key: "ui.smart_sort.reset_done"}));
                                    })
                                    .catch(error => showToast(ToastMessage.toast(coreT({key: "ui.common.restore_failed"}), error)));
                            },
                        },
                    ]);
                    break;
                default:
                    break;
            }
        },
        [runtime, reload, showToast],
    );

    let rowMenuItems: {label: string; action: string; danger?: boolean}[] = [];
    if (menuRule) {
        rowMenuItems = [
            {label: coreT({key: "ui.common.edit"}), action: 'edit'},
            {label: coreT({key: "ui.common.move_top"}), action: 'top'},
            {label: coreT({key: "ui.common.move_up"}), action: 'up'},
            {label: coreT({key: "ui.common.move_down"}), action: 'down'},
            {label: coreT({key: "ui.common.move_bottom"}), action: 'bottom'},
            // 内置规则仅可禁用不可删除（spec D3）。
            ...(SmartSortRule.isBuiltinId(menuRule.ruleId) ? [] : [{label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true}]),
        ];
    }

    return (
        <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
            <ManageHeader
                title={coreT({key: "ui.nav.smart_sort_rules"})}
                batchMode={batch.active}
                selectedCount={batch.selectedCount}
                onEnterBatch={batch.enter}
                onCancelBatch={batch.exit}
                onDelete={runBatchDelete}
                onSelectAll={rows.length > 0 ? () => batch.selectRange(rows.map(r => r.ruleId)) : undefined}
                allSelected={rows.length > 0 && batch.selectedCount === rows.length}
                actions={[
                    {label: coreT({key: "ui.common.enable"}), onPress: () => runBatchSetEnabled(true)},
                    {label: coreT({key: "ui.common.disable"}), onPress: () => runBatchSetEnabled(false)},
                ]}
                hint={coreT({key: "ui.smart_sort.batch_select_hint"})}
                normalActions={
                    <View style={styles.headerActions}>
                        <SecondaryButton label={coreT({key: "ui.common.more"})} tokens={tokens} onPress={() => setMoreMenuVisible(true)} />
                        <PrimaryButton label={coreT({key: "ui.common.new"})} tokens={tokens} onPress={createRule} />
                    </View>
                }
            />
            {loading && rows.length === 0 ? (
                <ActivityIndicator style={listScreenStyles.loader} />
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={item => item.ruleId}
                    contentContainerStyle={listScreenStyles.listContent}
                    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
                    ListEmptyComponent={<Text style={[listScreenStyles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.smart_sort.empty"})}</Text>}
                    renderItem={({item}) => (
                        <ConfigListCard
                            tokens={tokens}
                            selected={batch.isSelected(item.ruleId)}
                            onPress={() => {
                                if (batch.active) {
                                    batch.toggle(item.ruleId);
                                } else {
                                    navigation.navigate('SmartSortRuleEditor', {
                                        ruleId: item.ruleId,
                                    });
                                }
                            }}
                            leading={
                                batch.active ? (
                                    <BatchCheckbox checked={batch.isSelected(item.ruleId)} onToggle={() => batch.toggle(item.ruleId)} />
                                ) : (
                                    <Switch value={item.enabled} onValueChange={next => toggleEnabled(item, next)} trackColor={{false: tokens.border, true: tokens.primary}} />
                                )
                            }
                            title={item.name}
                            subtitle={`${SmartSortRule.isBuiltinId(item.ruleId) ? coreT({key: "ui.smart_sort.builtin_prefix"}) : ''}${item.description ?? '—'}`}
                            onMenuPress={batch.active ? undefined : () => setMenuRule(item)}
                            showChevron={!batch.active}
                        />
                    )}
                />
            )}
            <BottomSheetMenu visible={menuRule != null} title={menuRule?.name} items={rowMenuItems} onSelect={handleRowMenuSelect} onClose={() => setMenuRule(null)} />
            <BottomSheetMenu
                visible={moreMenuVisible}
                title={coreT({key: "ui.smart_sort.library_title"})}
                items={[
                    {label: coreT({key: "ui.agent.import_yaml"}), action: 'import'},
                    {label: coreT({key: "ui.agent.export_yaml"}), action: 'export'},
                    {label: coreT({key: "ui.common.reset_default"}), action: 'reset'},
                ]}
                onSelect={handleMoreSelect}
                onClose={() => setMoreMenuVisible(false)}
            />
        </View>
    );
}

const EMPTY_RULES: SmartSortRule[] = [];

const styles = StyleSheet.create({
    headerActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
});
