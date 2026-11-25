/**
 * MCP 服务器列表页（spec mcp-support Step 14）：全部已配置服务器按
 * `mcp.servers()` 动态渲染 + 行内启用开关 + 行菜单（删除）+
 * 底部「新建服务器」入口；点击行进详情页。
 *
 * 状态标签读连接管理器的 `serverStatuses()`（spec §五：server 级状态唯一读取
 * 面），只有「已连接 / 未连接」两态；server 带失败时副标题直显 `failure.detail`
 * 原文（不自写文案）。本页不主动发起连接（首次进入状态多为未连接，由详情页的
 * 连接/测试点亮）。长说明收进标题栏「?」帮助弹窗（照 SearchEnginesScreen 先例）。
 */
import React, {useCallback, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {McpServerConfig, McpServerStatus} from '@novel-master/core/mcp';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {HelpSection} from '@/components/common/HelpSection';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {HelpIcon} from '@/components/icons/TabIcons';
import {ModalShell} from '@/components/ui/ModalShell';
import {SecondaryButton} from '@/components/ui/Buttons';
import {useDismissOverlaysOnBlur} from '@/hooks/useDismissOverlaysOnBlur';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {settingsTranslator} from '@/i18n/settings';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 列表行：配置 × 连接状态（status 缺失时按 pending 兜底）。 */
interface McpServerRow {
    readonly config: McpServerConfig;
    readonly status: McpServerStatus;
}

const EMPTY_ROWS: readonly McpServerRow[] = [];

export function McpServersScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const mcp = runtime.mcp;
    const navigation = useNavigation<Nav>();
    const setStackOverride = useStackOverrideSetter();
    /** 行菜单当前指向的 server（undefined = 收起）。 */
    const [menuServerId, setMenuServerId] = useState<string | undefined>();
    /** 开关写库进行中的 server id（互斥连点；用 ref 避免整表 disabled 态闪烁）。 */
    const togglingRef = useRef<string | undefined>(undefined);
    /** 待确认删除的 server（undefined = 弹窗收起）。 */
    const [pendingDelete, setPendingDelete] = useState<string | undefined>();
    /** 删除写库进行中。 */
    const [deleting, setDeleting] = useState(false);
    /** 使用说明弹窗开关（标题栏「?」按钮）。 */
    const [helpVisible, setHelpVisible] = useState(false);

    const dismissAllOverlays = useCallback(() => {
        setMenuServerId(undefined);
        setPendingDelete(undefined);
        setHelpVisible(false);
    }, []);

    useDismissOverlaysOnBlur(dismissAllOverlays);

    // 标题栏 override 带「?」帮助按钮（照 SearchEnginesScreen：useFocusEffect 重设，
    // 详情页返回时列表页重新聚焦须重挂，否则「?」按钮丢失）。
    const syncHeaderOverride = useCallback(() => {
        setStackOverride({
            title: coreT({key: 'ui.nav.mcp_servers'}),
            showMenu: true,
            menuIcon: <HelpIcon color={tokens.text} />,
            onMenu: () => setHelpVisible(true),
        });
        return () => setStackOverride(undefined);
    }, [setStackOverride, tokens.text]);
    useFocusEffect(syncHeaderOverride);

    const {rows, loading, error, reload, setRows} = useFocusListReload({
        fetcher: useCallback(async () => {
            const read = await mcp.reload();
            // nm-throw: keep — fetcher 槽位契约：读失败进 useFocusListReload 的 error 态（UI 边界展示通道）
            if (!read.ok) throw read.error;
            const statuses = new Map(mcp.connectionManager.serverStatuses().map(status => [status.serverId, status]));
            return mcp.servers().map(config => ({config, status: statuses.get(config.id) ?? {serverId: config.id, state: 'pending' as const}}));
        }, [mcp]),
        fallbackValue: EMPTY_ROWS,
    });

    const menuRow = rows.find(row => row.config.id === menuServerId);
    const deleteRow = rows.find(row => row.config.id === pendingDelete);
    // 删除确认文案提前拼好：模板串含 CJK 长文案，内联进 JSX 会被 prettier 拆行。
    let deleteNotice = '';
    if (deleteRow != null) {
        deleteNotice = settingsTranslator({key: 'settings.mcp.delete_notice', params: {id: deleteRow.config.id}});
    }

    return (
        <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
            {loading && rows.length === 0 ? (
                <ActivityIndicator style={listScreenStyles.loader} />
            ) : error ? (
                <View style={styles.center}>
                    <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
                    <Pressable onPress={() => void reload()}>
                        <Text style={{color: tokens.primary, fontWeight: '600'}}>{settingsTranslator({key: 'settings.mcp.list.retry.mobile'})}</Text>
                    </Pressable>
                </View>
            ) : rows.length === 0 ? (
                <View style={styles.center}>
                    <Text style={[styles.empty, {color: tokens.textSecondary}]}>{settingsTranslator({key: 'settings.mcp.list.empty'})}</Text>
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={item => item.config.id}
                    contentContainerStyle={listScreenStyles.listContent}
                    refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
                    renderItem={({item}) => {
                        const failure = item.status.failure;
                        // 开关本身已表达启停态，副标题给描述（选填，可为空）；有失败时直显 failure.detail 原文（core 事实提示，不自写文案）。
                        const description = item.config.description.trim();
                        const failureText = failure?.detail ?? null;
                        const subtitle = [description.length > 0 ? description : null, failureText].filter(part => part != null).join(' · ');
                        return (
                            <ConfigListCard
                                tokens={tokens}
                                onPress={() => {
                                    navigation.navigate('McpServerDetail', {serverId: item.config.id});
                                }}
                                title={item.config.id}
                                subtitle={subtitle}
                                trailingMeta={
                                    <View style={styles.rowMeta}>
                                        {/* 状态胶囊（照 ApiKeyStatusTag 的 hex-alpha 底色形态）：只有两态，失败原文进详情页。 */}
                                        <View style={[styles.stateTag, {backgroundColor: item.status.state === 'ready' ? `${tokens.success}1A` : `${tokens.textSecondary}1A`}]}>
                                            <Text style={{color: item.status.state === 'ready' ? tokens.success : tokens.text, fontSize: 12, fontWeight: '600'}}>
                                                {settingsTranslator({key: item.status.state === 'ready' ? 'settings.mcp.list.connected' : 'settings.mcp.list.disconnected'})}
                                            </Text>
                                        </View>
                                        <Switch
                                            value={item.config.enabled}
                                            onValueChange={async next => {
                                                // 行开关：乐观翻转 + 失败回滚同一行；togglingRef 互斥保证同刻只有一行写库在途。
                                                if (togglingRef.current != null) {
                                                    return;
                                                }
                                                togglingRef.current = item.config.id;
                                                setRows(current => current.map(row => (row.config.id === item.config.id ? {config: {...row.config, enabled: next}, status: row.status} : row)));
                                                try {
                                                    await mcp.setEnabled(item.config.id, next);
                                                } catch (cause) {
                                                    setRows(current => current.map(row => (row.config.id === item.config.id ? {config: {...row.config, enabled: !next}, status: row.status} : row)));
                                                    showToast(ToastMessage.toast(settingsTranslator({key: 'settings.mcp.toast.toggle_failed.mobile'}), cause));
                                                } finally {
                                                    togglingRef.current = undefined;
                                                }
                                            }}
                                            disabled={deleting}
                                            trackColor={{false: tokens.border, true: tokens.primary}}
                                        />
                                    </View>
                                }
                                onMenuPress={() => setMenuServerId(item.config.id)}
                            />
                        );
                    }}
                />
            )}
            <View style={[styles.createBar, {borderTopColor: tokens.borderLight}]}>
                <SecondaryButton tokens={tokens} fullWidth label={settingsTranslator({key: 'settings.mcp.list.create'})} onPress={() => navigation.navigate('McpServerDetail', undefined)} disabled={deleting} />
            </View>
            <BottomSheetMenu
                visible={menuServerId != null}
                title={menuRow?.config.id}
                items={[
                    {label: settingsTranslator({key: 'settings.mcp.list.menu.delete'}), action: 'delete', danger: true, disabled: deleting},
                ]}
                onClose={() => setMenuServerId(undefined)}
                onSelect={action => {
                    const serverId = menuServerId;
                    setMenuServerId(undefined);
                    if (serverId == null) {
                        return;
                    }
                    if (action === 'delete') {
                        setPendingDelete(serverId);
                    }
                }}
            />
            {/* 删除确认：配置与 SKSP 密钥（bearer / headers / oauth）一并清除，不可撤销。 */}
            <ModalShell visible={pendingDelete != null} onClose={() => setPendingDelete(undefined)} variant="center" animationType="fade" panelStyle={styles.helpPanel}>
                <Text style={[styles.helpTitle, {color: tokens.text}]}>{settingsTranslator({key: 'settings.mcp.delete_title'})}</Text>
                <Text style={[styles.confirmBody, {color: tokens.textSecondary}]}>{deleteNotice}</Text>
                <View style={styles.confirmActions}>
                    <View style={styles.confirmAction}>
                        <SecondaryButton tokens={tokens} fullWidth label={settingsTranslator({key: 'settings.mcp.list.cancel'})} onPress={() => setPendingDelete(undefined)} disabled={deleting} />
                    </View>
                    <View style={styles.confirmAction}>
                        <SecondaryButton
                            tokens={tokens}
                            fullWidth
                            label={deleting ? settingsTranslator({key: 'settings.mcp.list.deleting.mobile'}) : settingsTranslator({key: 'settings.mcp.list.menu.delete'})}
                            onPress={async () => {
                                if (pendingDelete == null || deleting) {
                                    return;
                                }
                                setDeleting(true);
                                try {
                                    await mcp.remove(pendingDelete);
                                    showToast(settingsTranslator({key: 'settings.mcp.toast.deleted'}));
                                    setPendingDelete(undefined);
                                    await reload({silent: true});
                                } catch (cause) {
                                    showToast(ToastMessage.toast(settingsTranslator({key: 'settings.mcp.toast.delete_failed.mobile'}), cause));
                                } finally {
                                    setDeleting(false);
                                }
                            }}
                            disabled={deleting}
                        />
                    </View>
                </View>
            </ModalShell>
            {/* 使用说明弹窗：开关 / 认证（只讲事实的两段；失败原文已由状态位置直显，不再收录入口说明），无输入不避键盘。 */}
            <ModalShell visible={helpVisible} onClose={() => setHelpVisible(false)} variant="center" animationType="fade" panelStyle={styles.helpPanel}>
                <Text style={[styles.helpTitle, {color: tokens.text}]}>{coreT({key: 'ui.nav.mcp_servers'})}</Text>
                <HelpSection tokens={tokens} title={settingsTranslator({key: 'settings.mcp.help.toggle.title'})} body={settingsTranslator({key: 'settings.mcp.help.toggle.body'})} />
                <HelpSection tokens={tokens} title={settingsTranslator({key: 'settings.mcp.help.auth.title'})} body={settingsTranslator({key: 'settings.mcp.help.auth.body'})} />
                <Pressable onPress={() => setHelpVisible(false)} style={[styles.helpCloseRow, {borderTopColor: tokens.border}]}>
                    <Text style={{color: tokens.primary, fontWeight: '600'}}>{settingsTranslator({key: 'settings.mcp.help.dismiss'})}</Text>
                </Pressable>
            </ModalShell>
        </View>
    );
}

const styles = StyleSheet.create({
    center: {alignItems: 'center', gap: 12, padding: 24},
    error: {textAlign: 'center', lineHeight: 20},
    empty: {textAlign: 'center', lineHeight: 20},
    helpPanel: {
        borderRadius: 16,
        width: '100%',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 8,
    },
    helpTitle: {fontSize: 17, fontWeight: '600', marginBottom: 14},
    helpCloseRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 2,
        paddingVertical: 10,
        alignItems: 'center',
    },
    rowMeta: {flexDirection: 'row', alignItems: 'center', gap: 8},
    stateTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    createBar: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    confirmBody: {fontSize: 14, lineHeight: 21, marginBottom: 8},
    confirmActions: {flexDirection: 'row', gap: 12},
    confirmAction: {flex: 1},
});
