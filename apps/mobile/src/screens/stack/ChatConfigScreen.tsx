/**
 * 聊天相关偏好：父会话流式、子会话流式、思考提示词、富文本消息，以及压缩配置。
 */
import React, {useCallback, useState} from 'react';
import {DEFAULT_HIDE_START_DEPTH, type CompactionConditions} from '@novel-master/core/compaction';
import {useFocusEffect} from '@react-navigation/native';
import {Platform, StyleSheet, Switch} from 'react-native';
import {ProfileSwitchItem} from '../../components/profile/ProfileSwitchItem';
import {ProfileMenuItem} from '../../components/profile/ProfileMenuItem';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {AppUiPrefIo} from '../../storage/app-ui-pref-io';
import {APP_UI_KEY_CHAT_RICH_TEXT, APP_UI_KEY_MESSAGE_NOTIFICATION} from '../../storage/app-ui-keys';
import {AgentFinishedNotification} from '../../services/agent-finished-notification';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';

const DEFAULT_CONDITIONS: CompactionConditions = {
    schemaVersion: 4,
    enabled: false,
    tokenRatio: 0.8,
    hideStartDepth: DEFAULT_HIDE_START_DEPTH,
};

export function ChatConfigScreen() {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const {appUi} = useNovelMaster();
    const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
    const [subagentStreamEnabled, setSubagentStreamEnabled] = useState(true);
    const [thinkingContextEnabled, setThinkingContextEnabled] = useState(true);
    const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
    const [messageNotificationEnabled, setMessageNotificationEnabled] = useState(false);
    // 「通知权限」行三态：checking 兼作首帧占位与手动申请中的防重入标记。
    const [notificationPermission, setNotificationPermission] = useState<'authorized' | 'denied' | 'checking'>('checking');

    const [compactionEnabled, setCompactionEnabled] = useState(false);
    const [compactionTokenRatio, setCompactionTokenRatio] = useState('0.8');
    const [compactionHideStartDepth, setCompactionHideStartDepth] = useState(String(DEFAULT_HIDE_START_DEPTH));

    const refreshStreamPref = useCallback(async () => {
        const pref = await runtime.preferences.getLlmStreamEnabled();
        // 读取失败静默保持（错误通道迁移四期：旧 rejection 被焦点 .catch 吞掉，同款）。
        if (!pref.ok) {
            return;
        }
        setLlmStreamEnabled(pref.value);
    }, [runtime]);

    const refreshSubagentStreamPref = useCallback(async () => {
        const pref = await runtime.preferences.getSubagentStreamEnabled();
        // 读取失败静默保持（错误通道迁移四期：旧 rejection 被焦点 .catch 吞掉，同款）。
        if (!pref.ok) {
            return;
        }
        setSubagentStreamEnabled(pref.value);
    }, [runtime]);

    const refreshThinkingContextPref = useCallback(async () => {
        const pref = await runtime.preferences.getThinkingContextEnabled();
        // 读取失败静默保持（错误通道迁移四期：旧 rejection 被焦点 .catch 吞掉，同款）。
        if (!pref.ok) {
            return;
        }
        setThinkingContextEnabled(pref.value);
    }, [runtime]);

    const refreshChatRichTextPref = useCallback(async () => {
        if (appUi == null) {
            return;
        }
        setChatRichTextEnabled(await AppUiPrefIo.readBoolPref(appUi, APP_UI_KEY_CHAT_RICH_TEXT, false));
    }, [appUi]);

    const refreshMessageNotificationPref = useCallback(async () => {
        if (appUi == null) {
            return;
        }
        setMessageNotificationEnabled(await AppUiPrefIo.readBoolPref(appUi, APP_UI_KEY_MESSAGE_NOTIFICATION, false));
    }, [appUi]);

    const refreshNotificationPermission = useCallback(async () => {
        // 权限行仅 Android 渲染，非 Android 不查询。
        if (Platform.OS !== 'android') {
            return;
        }
        try {
            setNotificationPermission(await AgentFinishedNotification.getPermissionStatus());
        } catch {
            // 查询失败按未授权展示：权限行的点击出口始终可用（手动申请路径）。
            setNotificationPermission('denied');
        }
    }, []);

    const refreshCompaction = useCallback(async () => {
        const stored = await runtime.compactionConditions.getConditions();
        // 读取失败静默保持（错误通道迁移四期：旧 rejection 被焦点 .catch 吞掉，同款）。
        if (!stored.ok) {
            return;
        }
        const c = stored.value ?? DEFAULT_CONDITIONS;
        setCompactionEnabled(c.enabled);
        setCompactionTokenRatio(c.tokenRatio != null ? String(c.tokenRatio) : '');
        setCompactionHideStartDepth(c.hideStartDepth != null ? String(c.hideStartDepth) : String(DEFAULT_HIDE_START_DEPTH));
    }, [runtime]);

    const onScreenFocus = useCallback(() => {
        refreshStreamPref().catch(() => undefined);
        refreshSubagentStreamPref().catch(() => undefined);
        refreshThinkingContextPref().catch(() => undefined);
        refreshChatRichTextPref().catch(() => undefined);
        refreshMessageNotificationPref().catch(() => undefined);
        refreshNotificationPermission().catch(() => undefined);
        refreshCompaction().catch(() => undefined);
    }, [refreshStreamPref, refreshSubagentStreamPref, refreshThinkingContextPref, refreshChatRichTextPref, refreshMessageNotificationPref, refreshNotificationPermission, refreshCompaction]);
    useFocusEffect(onScreenFocus);

    const handleNotificationPermissionPress = useCallback(() => {
        // 防重入：申请中（checking）不重复发起；已授权（authorized）无需操作。
        if (notificationPermission !== 'denied') {
            return;
        }
        setNotificationPermission('checking');
        // 权限弹窗关闭不触发 navigation focus，回执是状态更新的可靠源。
        const permissionRequest = AgentFinishedNotification.requestPermissionManually();
        permissionRequest.then(setNotificationPermission).catch(() => setNotificationPermission('denied'));
    }, [notificationPermission]);

    // 四个偏好开关采用「乐观更新 + 失败回滚」：先立即翻转开关保证跟手，
    // 持久化 reject 时回滚到原值并 toast（未选「成功才翻转」——那会让开关
    // 在异步写入期间显得无响应）。回调里依次传写入动作与回滚动作。
    const persistSwitchWithRollback = useCallback(
        async (persist: () => Promise<void>, rollback: () => void) => {
            try {
                await persist();
            } catch (cause) {
                rollback();
                showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), cause));
            }
        },
        [showToast],
    );

    // 压缩配置改为即时保存（保存按钮已移除）：开关切换 / 输入完成即落库。
    // 从「即将生效的值」组装完整 conditions；校验失败或写库失败返回 false，
    // 由调用方决定回滚（开关回滚到原值；输入框保留用户输入待下次提交）。
    const persistCompaction = useCallback(
        async (next?: {enabled?: boolean; tokenRatio?: string; hideStartDepth?: string}): Promise<boolean> => {
            const enabled = next?.enabled ?? compactionEnabled;
            const ratioText = next?.tokenRatio ?? compactionTokenRatio;
            const hideText = next?.hideStartDepth ?? compactionHideStartDepth;
            const ratio = ratioText.trim() ? Number(ratioText) : undefined;
            const hide = hideText.trim() ? Number(hideText) : undefined;
            if (ratio != null && !Number.isFinite(ratio)) {
                showToast(coreT({key: "ui.chat_config.token_ratio_number"}));
                return false;
            }
            if (hide != null && !Number.isFinite(hide)) {
                showToast(coreT({key: "ui.chat_config.hidden_depth_number"}));
                return false;
            }
            if (enabled && ratio == null) {
                showToast(coreT({key: "ui.chat_config.token_ratio_required"}));
                return false;
            }
            const conditions: CompactionConditions = {
                schemaVersion: 4,
                enabled,
                ...(ratio != null ? {tokenRatio: ratio} : {}),
                ...(hide != null ? {hideStartDepth: hide} : {}),
            };
            try {
                await runtime.compactionConditions.setConditions(conditions);
                return true;
            } catch (error) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), error));
                return false;
            }
        },
        [compactionEnabled, compactionTokenRatio, compactionHideStartDepth, runtime, showToast],
    );

    // 通知权限三态文案（authorized / denied / 其余 pending）
    let permissionLabel: string;
    switch (notificationPermission) {
        case 'authorized': {
            permissionLabel = coreT({key: "ui.chat_config.perm_granted"});
            break;
        }
        case 'denied': {
            permissionLabel = coreT({key: "ui.chat_config.perm_denied"});
            break;
        }
        default: {
            permissionLabel = coreT({key: "ui.chat_config.perm_pending"});
        }
    }

    return (
        <ScreenFormLayout tokens={tokens}>
            <ProfileSwitchItem
                icon="⚡"
                label={coreT({key: "ui.chat_config.stream_parent"})}
                subtitle={llmStreamEnabled ? coreT({key: "ui.chat_config.stream_parent_on"}) : coreT({key: "ui.chat_config.stream_parent_off"})}
                value={llmStreamEnabled}
                tokens={tokens}
                onValueChange={enabled => {
                    setLlmStreamEnabled(enabled);
                    void persistSwitchWithRollback(
                        () => runtime.preferences.setLlmStreamEnabled(enabled),
                        () => setLlmStreamEnabled(!enabled),
                    );
                }}
            />
            <ProfileSwitchItem
                icon="🤖"
                label={coreT({key: "ui.chat_config.stream_sub"})}
                subtitle={subagentStreamEnabled ? coreT({key: "ui.chat_config.stream_sub_on"}) : coreT({key: "ui.chat_config.stream_sub_off"})}
                value={subagentStreamEnabled}
                tokens={tokens}
                onValueChange={enabled => {
                    setSubagentStreamEnabled(enabled);
                    void persistSwitchWithRollback(
                        () => runtime.preferences.setSubagentStreamEnabled(enabled),
                        () => setSubagentStreamEnabled(!enabled),
                    );
                }}
            />
            <ProfileSwitchItem
                icon="🧠"
                label={coreT({key: "ui.chat_config.thinking_prompt"})}
                subtitle={coreT({key: "ui.chat_config.thinking_prompt_hint"})}
                value={thinkingContextEnabled}
                tokens={tokens}
                onValueChange={enabled => {
                    setThinkingContextEnabled(enabled);
                    void persistSwitchWithRollback(
                        () => runtime.preferences.setThinkingContextEnabled(enabled),
                        () => setThinkingContextEnabled(!enabled),
                    );
                }}
            />
            <ProfileSwitchItem
                icon="📝"
                label={coreT({key: "ui.chat_config.rich_text"})}
                subtitle={chatRichTextEnabled ? coreT({key: "ui.chat_config.rich_text_on"}) : coreT({key: "ui.chat_config.rich_text_off"})}
                value={chatRichTextEnabled}
                tokens={tokens}
                onValueChange={enabled => {
                    setChatRichTextEnabled(enabled);
                    if (appUi) {
                        void persistSwitchWithRollback(
                            () => AppUiPrefIo.writeBoolPref(appUi, APP_UI_KEY_CHAT_RICH_TEXT, enabled),
                            () => setChatRichTextEnabled(!enabled),
                        );
                    }
                }}
            />

            <ProfileSwitchItem
                icon="🔔"
                label={coreT({key: "ui.chat_config.notifications"})}
                subtitle={messageNotificationEnabled ? coreT({key: "ui.chat_config.notifications_on"}) : coreT({key: "ui.chat_config.notifications_off"})}
                value={messageNotificationEnabled}
                tokens={tokens}
                onValueChange={enabled => {
                    setMessageNotificationEnabled(enabled);
                    if (appUi) {
                        void persistSwitchWithRollback(
                            async () => {
                                await AppUiPrefIo.writeBoolPref(appUi, APP_UI_KEY_MESSAGE_NOTIFICATION, enabled);
                                // 存储已持久化，通知模块的进程级副作用失败只 toast 不回滚
                                //（不易回滚，下次启动按存储态收敛）。
                                AgentFinishedNotification.setResidentEnabled(enabled).catch(cause => {
                                    showToast(ToastMessage.toast(coreT({key: "ui.chat_config.keepalive_toggle_failed"}), cause));
                                });
                                if (enabled) {
                                    // 关→开：权限申请前移到开关切换（拒绝过一次后不再自动弹）。
                                    AgentFinishedNotification.ensurePermission().catch(cause => {
                                        showToast(ToastMessage.toast(coreT({key: "ui.chat_config.permission_request_failed"}), cause));
                                    });
                                }
                            },
                            () => setMessageNotificationEnabled(!enabled),
                        );
                    }
                }}
            />

            {Platform.OS === 'android' ? (
                <ProfileMenuItem
                    icon="🔔"
                    label={coreT({key: "ui.chat_config.notification_permission"})}
                    value={permissionLabel}
                    onPress={handleNotificationPermissionPress}
                    tokens={tokens}
                />
            ) : null}

            <FormSectionCard title={coreT({key: "ui.chat_config.compact_section"})} tokens={tokens} hint={coreT({key: "ui.chat_config.compact_hint"})}>
                <FormField label={coreT({key: "ui.chat_config.hidden_start_depth"})} tokens={tokens} row>
                    <FormTextInput
                        tokens={tokens}
                        value={compactionHideStartDepth}
                        onChangeText={setCompactionHideStartDepth}
                        onEndEditing={() => {
                            void persistCompaction();
                        }}
                        keyboardType="number-pad"
                        placeholder="6"
                        style={styles.compactionInput}
                    />
                </FormField>
                <FormField label={coreT({key: "ui.chat_config.auto_compact"})} tokens={tokens} row>
                    <Switch
                        value={compactionEnabled}
                        onValueChange={enabled => {
                            setCompactionEnabled(enabled);
                            // 即时保存：无效（启用但无有效比例）或写库失败都回滚开关。
                            void persistCompaction({enabled}).then(ok => {
                                if (!ok) {
                                    setCompactionEnabled(!enabled);
                                }
                            });
                        }}
                        trackColor={{false: tokens.border, true: tokens.primary}}
                    />
                </FormField>
                {compactionEnabled ? (
                    <FormField label={coreT({key: "ui.chat_config.token_ratio"})} tokens={tokens} row>
                        <FormTextInput
                            tokens={tokens}
                            value={compactionTokenRatio}
                            onChangeText={setCompactionTokenRatio}
                            onEndEditing={() => {
                                void persistCompaction();
                            }}
                            keyboardType="decimal-pad"
                            placeholder="0.8"
                            style={styles.compactionInput}
                        />
                    </FormField>
                ) : null}
            </FormSectionCard>
        </ScreenFormLayout>
    );
}

const styles = StyleSheet.create({
    // row 模式下给输入框限宽，避免撑满整行把标签挤没。数字 / 小数输入 100 够用。
    compactionInput: {width: 100, textAlign: 'center'},
});
