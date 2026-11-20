/**
 * Confirm + run sessions.pushSessionTemplate：用当前聊天工作区整树覆盖项目工作区
 * （该项目所有会话的模板母本）。与 TemplatePullButton 完全镜像。
 */
import React, {useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import {SyncPushIcon} from '@/components/icons/TabIcons';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';

type Props = {
  scope: {kind: 'session'; sessionId: string};
  onPushed?: () => void;
  /** Inline toolbar: smaller padding, no border box. */
  compact?: boolean;
  /** Icon-only toolbar button (replaces text label). */
  iconOnly?: boolean;
};

/** 确认弹窗正文：一句话讲清覆盖事实与不可撤销即可，不展开项目工作区
 * 的作用说明（2026-09-08 真机反馈：描述过多）。 */
function confirmMessage(): string {
  return coreT({key: "ui.vfs.push_confirm_mobile"});
}

export function TemplatePushButton({
  scope,
  onPushed,
  compact = false,
  iconOnly = false,
}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [pushing, setPushing] = useState(false);

  const runPush = async () => {
    setPushing(true);
    try {
      await runtime.sessions.pushSessionTemplate(scope.sessionId);
      onPushed?.();
showToast(coreT({key: "ui.cloud_sync.push_done"}));
    } catch (error) {
showToast(ToastMessage.toast(coreT({key: "ui.common.push_failed"}), error));
    } finally {
      setPushing(false);
    }
  };

  const confirmPush = () => {
    Alert.alert(coreT({key: "ui.vfs.push_project_title"}), confirmMessage(), [
      {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
      {
        text: '推送',
        style: 'destructive',
        onPress: () => runPush().catch(() => undefined),
      },
    ]);
  };

  return (
    <Pressable
      accessibilityLabel={coreT({key: "ui.vfs.push_project_title"})}
      style={
        iconOnly
          ? styles.iconBtn
          : compact
          ? styles.btnCompact
          : [styles.btn, {borderColor: tokens.border}]
      }
      disabled={pushing}
      onPress={confirmPush}
    >
      {pushing ? (
        <ActivityIndicator size="small" color={tokens.primary} />
      ) : iconOnly ? (
        <SyncPushIcon color={tokens.primary} />
      ) : (
        <Text
          style={
            compact
              ? {color: tokens.primary, fontSize: 13, fontWeight: '600'}
              : {color: tokens.primary, fontWeight: '600'}
          }
        >
          {coreT({key: "ui.vfs.push_project_title"})}
        </Text>
      )}
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
