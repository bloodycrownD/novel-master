/**
 * MCP 服务器详情页（spec mcp-support Step 14）：分组卡片「连接 / 认证 / 工具」+
 * create 模式（无 route 参数）。
 *
 * - 连接：名称 / 传输类型（Streamable HTTP | SSE，SSE 归一保留但连接管理器报
 *   unsupported）/ 地址 / 超时时间（秒；保存时 ×1000 归一，下限 1000ms）；
 * - 认证：方式 FormSelectField（无 / API Key / OAuth）。bearer 的密钥只经 SKSP
 *   写入（ref `mcp/{id}/bearer`），不回显明文；OAuth 显示授权状态与「重新授权」
 *   （McpOauthService.start → 系统浏览器，回调由 deep link service 接住）；
 * - 工具：测试连接（invalidate + 重拉快照）+ server 状态行（不可用时直显
 *   `failure.detail` 原文，可选中复制）+ 每个工具的启停开关（KKV
 *   `nm-mcp/disabledTools`，过滤发生在 connectionManager 快照出口——开关
 *   真正决定工具是否注册进 agent）。
 *
 * 界面说明文字按 Step 14 五条：一组只出现一次（工具组脚注），字段级 hint 只留
 * 单位与「已保存」事实。表单骨架照 SearchEngineDetailScreen 先例。
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, McpSecretRefs, type McpServerConfig, type McpServerStatus, type McpToolSnapshot} from '@novel-master/core/mcp';
import type {SettingsMessageKey} from '@novel-master/core/settings';
import {FormChipGroup, type ChipOption} from '@/components/form/FormChipGroup';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSelectField} from '@/components/form/FormSelectField';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {ModalShell} from '@/components/ui/ModalShell';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {settingsTranslator} from '@/i18n/settings';
import {McpOauthService} from '@/services/mcp-oauth.service';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'McpServerDetail'>;

/** 表单草稿：提交前解析/归一（超时秒 → 毫秒，传输类型 → transport 联合）。 */
interface McpServerDraft {
    name: string;
    transport: 'http' | 'sse';
    url: string;
    /** 输入框原始文本（秒）；保存时解析，非法 / 缺失回缺省预算。 */
    timeoutSeconds: string;
    authType: 'none' | 'bearer' | 'oauth';
}

/** 认证方式三态（与 McpAuthConfig 的 type 对齐，none/bearer/oauth）。 */
type AuthTypeOption = 'none' | 'bearer' | 'oauth';

const TRANSPORT_OPTIONS: ReadonlyArray<ChipOption<'http' | 'sse'>> = [
    {value: 'http', label: 'Streamable HTTP'},
    {value: 'sse', label: 'SSE'},
];

const EMPTY_DRAFT: McpServerDraft = {name: '', transport: 'http', url: '', timeoutSeconds: '120', authType: 'none'};

/** 在途写操作（互斥：同刻只允许一个；null = 空闲）。 */
type WriteOp = 'save' | 'clear_key' | 'delete';

export function McpServerDetailScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const mcp = runtime.mcp;
    const navigation = useNavigation<Nav>();
    const route = useRoute<DetailRoute>();
    const setStackOverride = useStackOverrideSetter();

    /** undefined = create 模式（新建服务器）。 */
    const serverId = route.params?.serverId;

    const [draft, setDraft] = useState<McpServerDraft>(EMPTY_DRAFT);
    const [loading, setLoading] = useState(true);
    /** 在途写操作（保存 / 清除密钥互斥；null = 空闲）。 */
    const [writeOp, setWriteOp] = useState<WriteOp | null>(null);
    /** API Key 草稿（留空 = 不改已存密钥；回读后清空）。 */
    const [apiKeyDraft, setApiKeyDraft] = useState('');
    /** 已存 bearer 密钥（只读状态位，不回显明文）。 */
    const [hasBearerKey, setHasBearerKey] = useState(false);
    /** OAuth 授权状态（SKSP oauth 键的 tokens 判定）。 */
    const [oauthAuthorized, setOauthAuthorized] = useState(false);
    /** 该 server 的工具快照（connectionManager 缓存，TTL 60s）。 */
    const [tools, setTools] = useState<readonly McpToolSnapshot[]>([]);
    /** 该 server 的禁用工具名清单（镜像读 + 本地乐观更新）。 */
    const [disabledTools, setDisabledTools] = useState<readonly string[]>([]);
    /** 该 server 的连接状态（测试连接 / 加载后刷新）。 */
    const [status, setStatus] = useState<McpServerStatus | null>(null);
    /** 测试连接进行中（互斥连点）。 */
    const [testing, setTesting] = useState(false);
    /** 删除确认弹窗开关。 */
    const [confirmDelete, setConfirmDelete] = useState(false);

    const isCreate = serverId == null;
    const savedConfig = useRef<McpServerConfig | null>(null);
    let title = settingsTranslator({key: 'settings.mcp.detail.create_action'});
    if (savedConfig.current != null) {
        title = savedConfig.current.name;
    }

    // 详情页标题用服务器名（create 模式回「新建服务器」）。
    const syncHeader = useCallback(() => {
        setStackOverride({title});
        return () => setStackOverride(undefined);
    }, [setStackOverride, title]);
    useFocusEffect(syncHeader);

    /** 从该 server 的快照与状态面刷新工具卡数据（不置全屏 loading）。 */
    const refreshTools = useCallback(async () => {
        const snapshot = await mcp.connectionManager.snapshotTools();
        setTools(snapshot.filter(entry => entry.serverId === serverId));
        setStatus(mcp.connectionManager.serverStatuses().find(candidate => candidate.serverId === serverId) ?? null);
    }, [mcp, serverId]);

    /** 首屏加载：表单回填立即出（先 setLoading(false)），工具 / 授权状态渐次填充。 */
    const load = useCallback(
        async (options?: {silent?: boolean}) => {
            const silent = options?.silent === true;
            if (!silent) {
                setLoading(true);
            }
            try {
                const servers = mcp.servers().find(candidate => candidate.id === serverId);
                savedConfig.current = servers ?? null;
                if (servers == null) {
                    setDraft(EMPTY_DRAFT);
                } else {
                    setDraft({
                        name: servers.name,
                        transport: servers.transport.type === 'sse' ? 'sse' : 'http',
                        url: servers.transport.type === 'stdio' ? '' : servers.transport.url,
                        timeoutSeconds: String(Math.round(servers.timeoutMs / 1000)),
                        authType: servers.auth.type === 'oauth' ? 'oauth' : servers.auth.type === 'bearer' ? 'bearer' : 'none',
                    });
                }
                setApiKeyDraft('');
                setDisabledTools(serverId == null ? [] : mcp.disabledTools(serverId));
            } finally {
                setLoading(false);
            }
            if (serverId == null) {
                return;
            }
            try {
                const [bearerKey, authorized] = await Promise.all([runtime.secretStore.has(McpSecretRefs.bearer(serverId)), McpOauthService.authorized(runtime, serverId)]);
                setHasBearerKey(bearerKey);
                setOauthAuthorized(authorized);
            } catch {
                setHasBearerKey(false);
                setOauthAuthorized(false);
            }
            try {
                await refreshTools();
            } catch {
                // 工具拉取失败不阻断表单（连接失败在状态区可见；快照保持空列表）
                setTools([]);
                setStatus(mcp.connectionManager.serverStatuses().find(candidate => candidate.serverId === serverId) ?? null);
            }
        },
        [mcp, refreshTools, runtime, serverId],
    );

    useEffect(() => {
        load().catch(() => undefined);
    }, [load]);

    // route 参数防御：配置清单里没有该 id（深链 / 已删除）→ 提示后退回列表。
    useEffect(() => {
        if (serverId != null && !loading && savedConfig.current == null) {
            showToast(settingsTranslator({key: 'settings.mcp.toast.server_not_found.mobile', params: {name: serverId}}));
            navigation.goBack();
        }
    }, [loading, navigation, serverId, showToast]);

    // nm-style: keep-local — 保存分流 create/edit 两分支，共享 writeOp 互斥态、密钥写入与失败回读；内联进 footer 按钮会拆散互斥与回读状态机
    const handleSave = async () => {
        if (writeOp != null) {
            return;
        }
        const name = draft.name.trim();
        const url = draft.url.trim();
        if (name === '') {
            showToast(settingsTranslator({key: 'settings.mcp.validation.name_required'}));
            return;
        }
        if (url === '') {
            showToast(settingsTranslator({key: 'settings.mcp.validation.url_required'}));
            return;
        }
        const timeoutSeconds = Number.parseInt(draft.timeoutSeconds.trim(), 10);
        const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.max(MCP_MIN_TIMEOUT_MS, timeoutSeconds * 1000) : MCP_DEFAULT_TIMEOUT_MS;
        const configId = serverId ?? `mcp:${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
        // bearer 密钥先写 SKSP 再落配置（与 core importExternal 的先 SKSP 后 KKV 同序）：
        // SKSP 失败时中止保存，不留下无密钥的 bearer 配置。
        const keyDraft = apiKeyDraft.trim();
        if (draft.authType === 'bearer' && keyDraft.length > 0) {
            await runtime.secretStore.set(McpSecretRefs.bearer(configId), keyDraft);
        }
        const config: McpServerConfig = {
            id: configId,
            name,
            enabled: savedConfig.current?.enabled ?? true,
            transport: draft.transport === 'sse' ? {type: 'sse', url} : {type: 'http', url},
            timeoutMs,
            auth: draft.authType === 'oauth' ? {type: 'oauth'} : draft.authType === 'bearer' ? {type: 'bearer', secretRef: McpSecretRefs.bearer(configId)} : {type: 'none'},
        };
        setWriteOp('save');
        try {
            await mcp.save(config);
            showToast(settingsTranslator({key: 'settings.mcp.toast.saved'}));
            if (isCreate) {
                navigation.goBack();
                return;
            }
            await load({silent: true});
        } catch (cause) {
            showToast(ToastMessage.toast(settingsTranslator({key: 'settings.mcp.toast.save_failed.mobile'}), cause));
            await load({silent: true});
        } finally {
            setWriteOp(null);
        }
    };

    // nm-style: keep-local — 短写操作互斥模板：clear_key / delete 两处共用 writeOp 互斥态与失败 toast 映射；内联进各按钮会复制互斥状态机
    const runWrite = async (op: WriteOp, go: (id: string) => Promise<void>) => {
        if (serverId == null || writeOp != null) {
            return;
        }
        setWriteOp(op);
        try {
            await go(serverId);
        } catch (cause) {
            const failKeys: Record<WriteOp, SettingsMessageKey> = {save: 'settings.mcp.toast.save_failed.mobile', clear_key: 'settings.mcp.toast.clear_key_failed.mobile', delete: 'settings.mcp.toast.delete_failed.mobile'};
            showToast(ToastMessage.toast(settingsTranslator({key: failKeys[op]}), cause));
        } finally {
            setWriteOp(null);
        }
    };

    if (loading) {
        return (
            <View style={[styles.centered, {backgroundColor: tokens.background}]}>
                <ActivityIndicator color={tokens.primary} />
            </View>
        );
    }

    // 已删除/脏参数退场中：不渲染表单（load 内已提示并 goBack）。
    if (serverId != null && savedConfig.current == null) {
        return <View style={[styles.centered, {backgroundColor: tokens.background}]} />;
    }

    const patchDraft = (patch: Partial<McpServerDraft>) => setDraft(current => ({...current, ...patch}));
    const isBearer = draft.authType === 'bearer';
    const isOauth = draft.authType === 'oauth';
    // 测试连接 / 工具卡只在编辑模式出现（create 模式配置未落库，连接管理器查不到）。
    const statusLine = (() => {
        if (status == null) {
            return null;
        }
        if (status.state === 'ready') {
            return {text: `${settingsTranslator({key: 'settings.mcp.detail.status_ready'})} · ${settingsTranslator({key: 'settings.mcp.list.tool_count', params: {count: status.toolCount ?? tools.length}})}`, color: tokens.success};
        }
        if (status.state === 'pending') {
            return {text: settingsTranslator({key: 'settings.mcp.detail.status_pending'}), color: tokens.textSecondary};
        }
        if (status.state === 'disabled') {
            return {text: settingsTranslator({key: 'settings.mcp.detail.status_disabled'}), color: tokens.textSecondary};
        }
        // 状态不可用：状态位置直显 core 事实提示（failure.detail），不自写文案。
        return {text: status.failure?.detail ?? settingsTranslator({key: 'settings.mcp.detail.status_pending'}), color: tokens.danger};
    })();

    return (
        <ScreenFormLayout
            tokens={tokens}
            footer={
                <StickyFormFooter
                    tokens={tokens}
                    label={isCreate ? settingsTranslator({key: 'settings.mcp.detail.create_action'}) : settingsTranslator({key: 'settings.mcp.detail.save_action'})}
                    onPress={() => {
                        handleSave().catch(() => undefined);
                    }}
                    loading={writeOp === 'save'}
                    disabled={writeOp != null}
                />
            }
        >
            <FormSectionCard title={settingsTranslator({key: 'settings.mcp.detail.connection_section'})} tokens={tokens}>
                <FormField label={settingsTranslator({key: 'settings.mcp.detail.name_label'})} tokens={tokens}>
                    <FormTextInput tokens={tokens} value={draft.name} onChangeText={text => patchDraft({name: text})} placeholder={settingsTranslator({key: 'settings.mcp.detail.name_placeholder'})} autoCapitalize="none" autoCorrect={false} />
                </FormField>
                <FormField label={settingsTranslator({key: 'settings.mcp.detail.transport_label'})} tokens={tokens}>
                    <FormChipGroup tokens={tokens} options={TRANSPORT_OPTIONS} value={draft.transport} onChange={transport => patchDraft({transport})} />
                </FormField>
                <FormField label={settingsTranslator({key: 'settings.mcp.detail.url_label'})} tokens={tokens}>
                    <FormTextInput tokens={tokens} value={draft.url} onChangeText={text => patchDraft({url: text})} placeholder={settingsTranslator({key: 'settings.mcp.detail.url_placeholder'})} autoCapitalize="none" autoCorrect={false} multiline submitBehavior="blurAndSubmit" style={styles.urlInput} />
                </FormField>
                <FormField label={settingsTranslator({key: 'settings.mcp.detail.timeout_label'})} tokens={tokens} hint={settingsTranslator({key: 'settings.mcp.detail.timeout_hint.mobile'})}>
                    <FormTextInput tokens={tokens} value={draft.timeoutSeconds} onChangeText={text => patchDraft({timeoutSeconds: text})} keyboardType="number-pad" autoCapitalize="none" autoCorrect={false} />
                </FormField>
            </FormSectionCard>
            <FormSectionCard title={settingsTranslator({key: 'settings.mcp.detail.auth_section'})} tokens={tokens}>
                <FormField label={settingsTranslator({key: 'settings.mcp.detail.auth_label'})} tokens={tokens}>
                    <FormSelectField
                        tokens={tokens}
                        value={draft.authType}
                        onChange={value => patchDraft({authType: value as AuthTypeOption})}
                        options={[
                            {value: 'none', label: settingsTranslator({key: 'settings.mcp.detail.auth_none'})},
                            {value: 'bearer', label: settingsTranslator({key: 'settings.mcp.detail.auth_bearer.mobile'})},
                            {value: 'oauth', label: settingsTranslator({key: 'settings.mcp.detail.auth_oauth'})},
                        ]}
                        sheetTitle={settingsTranslator({key: 'settings.mcp.detail.auth_label'})}
                        placeholder={settingsTranslator({key: 'settings.mcp.detail.auth_label'})}
                    />
                </FormField>
                {isBearer ? (
                    <>
                        <FormField
                            label={settingsTranslator({key: 'settings.mcp.detail.api_key_label'})}
                            tokens={tokens}
                            hint={hasBearerKey ? settingsTranslator({key: 'settings.mcp.detail.api_key_saved_hint'}) : settingsTranslator({key: 'settings.mcp.detail.api_key_store_hint'})}
                        >
                            <FormTextInput tokens={tokens} value={apiKeyDraft} onChangeText={setApiKeyDraft} placeholder={hasBearerKey ? settingsTranslator({key: 'settings.mcp.detail.api_key_placeholder.mobile'}) : ''} secureTextEntry autoCapitalize="none" autoCorrect={false} />
                        </FormField>
                        {!isCreate && hasBearerKey ? (
                            <SecondaryButton
                                tokens={tokens}
                                fullWidth
                                label={writeOp === 'clear_key' ? settingsTranslator({key: 'settings.mcp.detail.clearing_key'}) : settingsTranslator({key: 'settings.mcp.detail.clear_key.mobile'})}
                                onPress={() => {
                                    void runWrite('clear_key', async id => {
                                        await runtime.secretStore.delete(McpSecretRefs.bearer(id));
                                        setHasBearerKey(false);
                                        showToast(settingsTranslator({key: 'settings.mcp.toast.key_cleared'}));
                                    });
                                }}
                                disabled={writeOp != null}
                            />
                        ) : null}
                    </>
                ) : null}
                {isOauth && !isCreate ? (
                    <>
                        <FormField row label={settingsTranslator({key: 'settings.mcp.detail.oauth_status_label'})} tokens={tokens}>
                            <View style={[styles.stateTag, {backgroundColor: oauthAuthorized ? `${tokens.success}1A` : `${tokens.textSecondary}1A`}]}>
                                <Text style={{color: oauthAuthorized ? tokens.success : tokens.text, fontSize: 12, fontWeight: '600'}}>{settingsTranslator({key: oauthAuthorized ? 'settings.mcp.detail.authorized' : 'settings.mcp.detail.not_authorized'})}</Text>
                            </View>
                        </FormField>
                        <SecondaryButton
                            tokens={tokens}
                            fullWidth
                            label={settingsTranslator({key: 'settings.mcp.detail.reauthorize.mobile'})}
                            onPress={async () => {
                                if (serverId == null) {
                                    return;
                                }
                                const started = await McpOauthService.start(runtime, serverId);
                                if (!started.ok) {
                                    showToast(ToastMessage.toast(settingsTranslator({key: 'settings.mcp.toast.oauth_start_failed.mobile'}), started.error));
                                    return;
                                }
                                showToast(settingsTranslator({key: 'settings.mcp.toast.oauth_started'}));
                            }}
                            disabled={writeOp != null}
                        />
                    </>
                ) : null}
            </FormSectionCard>
            {!isCreate ? (
                <FormSectionCard
                    title={settingsTranslator({key: 'settings.mcp.detail.tools_section'})}
                    hint={settingsTranslator({key: 'settings.mcp.detail.tools_hint'})}
                    rightAction={
                        <Pressable
                            onPress={() => {
                                // 测试连接：失效缓存重拉快照（预算内未完成记 pending，被拒记 failed）；快照拉取失败被连接管理器隔离，这里不会 reject。
                                if (serverId == null || testing) {
                                    return;
                                }
                                setTesting(true);
                                mcp.connectionManager.invalidate(serverId);
                                void refreshTools().finally(() => setTesting(false));
                            }}
                            hitSlop={8}
                            disabled={testing}
                        >
                            <Text style={{color: tokens.primary, fontSize: 14, fontWeight: '600'}}>{testing ? settingsTranslator({key: 'settings.mcp.detail.testing'}) : settingsTranslator({key: 'settings.mcp.detail.test_connection'})}</Text>
                        </Pressable>
                    }
                    tokens={tokens}
                >
                    {statusLine != null ? <Text selectable style={[styles.statusLine, {color: statusLine.color}]}>{statusLine.text}</Text> : null}
                    {tools.length === 0 ? null : (
                        <View style={styles.toolList}>
                            {tools.map(tool => (
                                <FormSwitchRow
                                    key={`${tool.serverId}:${tool.toolName}`}
                                    label={tool.toolName}
                                    tokens={tokens}
                                    value={!disabledTools.includes(tool.toolName)}
                                    onValueChange={next => {
                                        // 工具启停乐观更新：本地翻转 + KKV 写（连接管理器快照出口即时生效）+ 失败回滚；!isCreate 分支内 serverId 必有值。
                                        const previous = disabledTools;
                                        setDisabledTools(next ? previous.filter(name => name !== tool.toolName) : [...previous, tool.toolName]);
                                        mcp.setToolDisabled(serverId!, tool.toolName, !next).catch(() => {
                                            setDisabledTools(previous);
                                            showToast(settingsTranslator({key: 'settings.mcp.toast.toggle_failed.mobile'}));
                                        });
                                    }}
                                    description={tool.toolDescription}
                                />
                            ))}
                        </View>
                    )}
                </FormSectionCard>
            ) : null}
            {!isCreate ? (
                <FormSectionCard tokens={tokens} title={settingsTranslator({key: 'settings.mcp.delete_title'})} hint={settingsTranslator({key: 'settings.mcp.delete_notice', params: {name: title}})}>
                    <SecondaryButton tokens={tokens} fullWidth label={settingsTranslator({key: 'settings.mcp.list.menu.delete'})} onPress={() => setConfirmDelete(true)} disabled={writeOp != null} />
                </FormSectionCard>
            ) : null}
            {/* 删除确认：配置与 SKSP 密钥一并清除，二次确认后回列表。 */}
            <ModalShell visible={confirmDelete} onClose={() => setConfirmDelete(false)} variant="center" animationType="fade" panelStyle={styles.confirmPanel}>
                <Text style={[styles.confirmTitle, {color: tokens.text}]}>{settingsTranslator({key: 'settings.mcp.delete_title'})}</Text>
                <Text style={[styles.confirmBody, {color: tokens.textSecondary}]}>{settingsTranslator({key: 'settings.mcp.delete_notice', params: {name: title}})}</Text>
                <View style={styles.confirmActions}>
                    <View style={styles.confirmAction}>
                        <SecondaryButton tokens={tokens} fullWidth label={settingsTranslator({key: 'settings.mcp.list.cancel'})} onPress={() => setConfirmDelete(false)} disabled={writeOp != null} />
                    </View>
                    <View style={styles.confirmAction}>
                        <SecondaryButton
                            tokens={tokens}
                            fullWidth
                            label={writeOp === 'delete' ? settingsTranslator({key: 'settings.mcp.list.deleting.mobile'}) : settingsTranslator({key: 'settings.mcp.list.menu.delete'})}
                            onPress={() => {
                                void runWrite('delete', async id => {
                                    await mcp.remove(id);
                                    showToast(settingsTranslator({key: 'settings.mcp.toast.deleted'}));
                                    setConfirmDelete(false);
                                    navigation.goBack();
                                });
                            }}
                            disabled={writeOp != null}
                        />
                    </View>
                </View>
            </ModalShell>
        </ScreenFormLayout>
    );
}

const styles = StyleSheet.create({
    centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    // textarea：起始与单行输入框同高（44），内容折行时随行数自动长高。
    urlInput: {minHeight: 44},
    statusLine: {fontSize: 14, lineHeight: 20},
    toolList: {gap: 4},
    stateTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    confirmPanel: {
        borderRadius: 16,
        width: '100%',
        padding: 20,
    },
    confirmTitle: {fontSize: 17, fontWeight: '600', marginBottom: 10},
    confirmBody: {fontSize: 14, lineHeight: 21, marginBottom: 14},
    confirmActions: {flexDirection: 'row', gap: 12},
    confirmAction: {flex: 1},
});
