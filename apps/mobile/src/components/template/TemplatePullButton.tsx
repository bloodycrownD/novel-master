/**
 * Confirm + run sessions.pullTemplate（§14 M6；project 域 pull 已拆除，仅支持 session 域）。
 */
import React, {useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text} from 'react-native';
import {SyncPullIcon} from '../icons/TabIcons';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Props = {
  scope: {kind: 'session'; sessionId: string};
  onPulled?: () => void;
  /** Inline toolbar: smaller padding, no border box. */
  compact?: boolean;
  /** Icon-only toolbar button (replaces text label). */
  iconOnly?: boolean;
};

function confirmMessage(): string {
  return '将从项目工作区覆盖当前聊天工作区，本地修改将丢失。确定继续？';
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
      await runtime.sessions.pullTemplate(scope.sessionId);
      onPulled?.();
      showToast('同步完成');
    } catch (error) {
      showToast(toastMessage('同步失败', error));
    } finally {
      setPulling(false);
    }
  };

  const confirmPull = () => {
    Alert.alert('从上级同步', confirmMessage(), [
      {text: '取消', style: 'cancel'},
      {
        text: '同步',
        style: 'destructive',
        onPress: () => runPull().catch(() => undefined),
      },
    ]);
  };

  return (
    <Pressable
      accessibilityLabel="从上级同步"
      style={
        iconOnly
          ? styles.iconBtn
          : compact
            ? styles.btnCompact
            : [styles.btn, {borderColor: tokens.border}]
      }
      disabled={pulling}
      onPress={confirmPull}>
      {pulling ? (
        <ActivityIndicator size="small" color={tokens.primary} />
      ) : iconOnly ? (
        <SyncPullIcon color={tokens.primary} />
      ) : (
        <Text
          style={
            compact
              ? {color: tokens.primary, fontSize: 13, fontWeight: '600'}
              : {color: tokens.primary, fontWeight: '600'}
          }>
          从上级同步
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
