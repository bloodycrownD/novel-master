/**
 * Confirm + run sessions.pushTemplate：用当前聊天工作区整树覆盖项目工作区
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
import {toastMessage} from '@/errors/toast-message';

type Props = {
  scope: {kind: 'session'; sessionId: string};
  onPushed?: () => void;
  /** Inline toolbar: smaller padding, no border box. */
  compact?: boolean;
  /** Icon-only toolbar button (replaces text label). */
  iconOnly?: boolean;
};

function confirmMessage(): string {
  return '将用当前聊天工作区覆盖项目工作区。项目工作区是该项目所有会话的模板母本，之后新建的会话与其它会话的「从上级同步」都会拿到覆盖后的内容。';
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
      await runtime.sessions.pushTemplate(scope.sessionId);
      onPushed?.();
      showToast('推送完成');
    } catch (error) {
      showToast(toastMessage('推送失败', error));
    } finally {
      setPushing(false);
    }
  };

  const confirmPush = () => {
    Alert.alert('推送到项目工作区', confirmMessage(), [
      {text: '取消', style: 'cancel'},
      {
        text: '推送',
        style: 'destructive',
        onPress: () => runPush().catch(() => undefined),
      },
    ]);
  };

  return (
    <Pressable
      accessibilityLabel="推送到项目工作区"
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
          推送到项目工作区
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
