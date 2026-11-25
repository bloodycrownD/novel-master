/**
 * Confirm + run sessions.pullSessionTemplate（§14 M6；project 域 pull 已拆除，仅支持 session 域）。
 */
import React, {useState} from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import {SyncPullIcon} from '@/components/icons/TabIcons';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';

type Props = {
    scope: {kind: 'session'; sessionId: string};
    onPulled?: () => void;
    /** Inline toolbar: smaller padding, no border box. */
    compact?: boolean;
    /** Icon-only toolbar button (replaces text label). */
    iconOnly?: boolean;
};

function confirmMessage(): string {
    return coreT({key: "ui.vfs.pull_confirm"});
}

export function TemplatePullButton({
    scope,
    onPulled,
    compact = false,
    iconOnly = false,
}: Props) {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();
    const [pulling, setPulling] = useState(false);

    const runPull = async () => {
        setPulling(true);
        try {
            await runtime.sessions.pullSessionTemplate(scope.sessionId);
            onPulled?.();
            showToast(coreT({key: "ui.vfs.sync_done"}));
        } catch (error) {
            showToast(ToastMessage.toast(coreT({key: "ui.common.sync_failed"}), error));
        } finally {
            setPulling(false);
        }
    };

    const confirmPull = () => {
        Alert.alert(coreT({key: "ui.vfs.sync_menu_title"}), confirmMessage(), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.vfs.sync_action"}),
                style: 'destructive',
                onPress: () => runPull().catch(() => undefined),
            },
        ]);
    };

    // 图标态走方形图标钮，紧凑态小钮，普通态带边框标准钮
    let triggerStyle: StyleProp<ViewStyle>;
    if (iconOnly) {
        triggerStyle = styles.iconBtn;
    } else if (compact) {
        triggerStyle = styles.btnCompact;
    } else {
        triggerStyle = [styles.btn, {borderColor: tokens.border}];
    }

    // 拉取中转圈；图标态只出图标；文本态按 compact 切字号
    let bodyNode: React.ReactNode;
    if (pulling) {
        bodyNode = <ActivityIndicator size="small" color={tokens.primary} />;
    } else if (iconOnly) {
        bodyNode = <SyncPullIcon color={tokens.primary} />;
    } else {
        bodyNode = (
            <Text
                style={
                    compact
                        ? {color: tokens.primary, fontSize: 13, fontWeight: '600'}
                        : {color: tokens.primary, fontWeight: '600'}
                }
            >
                {coreT({key: "ui.vfs.sync_menu_title"})}
            </Text>
        );
    }

    return (
        <Pressable
            accessibilityLabel={coreT({key: "ui.vfs.sync_menu_title"})}
            style={triggerStyle}
            disabled={pulling}
            onPress={confirmPull}
        >
            {bodyNode}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    btn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        minWidth: 96,
        alignItems: 'center',
    },
    btnCompact: {
        paddingHorizontal: 6,
        paddingVertical: 8,
        alignItems: 'center',
    },
    iconBtn: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
    },
});
