/**
 * Confirm + run projects.pullTemplate or sessions.pullTemplate (§14 M6).
 */
import React, {useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Props = {
  scope:
    | {kind: 'project'; projectId: string}
    | {kind: 'session'; sessionId: string};
  onPulled?: () => void;
  /** Inline toolbar: smaller padding, no border box. */
  compact?: boolean;
};

function confirmMessage(scope: Props['scope']): string {
  if (scope.kind === 'project') {
    return '将从全局模板覆盖当前项目模板，本地修改将丢失。确定继续？';
  }
  return '将从项目模板覆盖当前会话工作区，本地修改将丢失。确定继续？';
}

export function TemplatePullButton({scope, onPulled, compact = false}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const [pulling, setPulling] = useState(false);

  const runPull = async () => {
    setPulling(true);
    try {
      if (scope.kind === 'project') {
        await runtime.projects.pullTemplate(scope.projectId);
      } else {
        await runtime.sessions.pullTemplate(scope.sessionId);
      }
      onPulled?.();
      showToast('同步完成');
    } catch (error) {
      showToast(toastMessage('同步失败', error));
    } finally {
      setPulling(false);
    }
  };

  const confirmPull = () => {
    Alert.alert('从上级同步', confirmMessage(scope), [
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
      style={compact ? styles.btnCompact : [styles.btn, {borderColor: tokens.border}]}
      disabled={pulling}
      onPress={confirmPull}>
      {pulling ? (
        <ActivityIndicator size="small" color={tokens.primary} />
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
});
