/**
 * 自动更新检查结果首屏弹窗（已最新 / 检查失败）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {AppModal} from '../ui/AppModal';

export type UpdateCheckResultKind = 'up-to-date' | 'error';

export const UPDATE_CHECK_RESULT_TITLE = '版本检查';
export const UPDATE_CHECK_UP_TO_DATE_MESSAGE = '当前已是最新版本';
export const UPDATE_CHECK_FAILED_MESSAGE = '无法检查更新，请检查网络';

type Props = {
  visible: boolean;
  kind: UpdateCheckResultKind;
  onClose: () => void;
  onSnoozeToday: () => void | Promise<void>;
};

function messageForKind(kind: UpdateCheckResultKind): string {
  return kind === 'up-to-date'
    ? UPDATE_CHECK_UP_TO_DATE_MESSAGE
    : UPDATE_CHECK_FAILED_MESSAGE;
}

export function UpdateCheckResultModal({
  visible,
  kind,
  onClose,
  onSnoozeToday,
}: Props) {
  const {tokens} = useTheme();

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.panel, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>
            {UPDATE_CHECK_RESULT_TITLE}
          </Text>
          <Text style={[styles.message, {color: tokens.textSecondary}]}>
            {messageForKind(kind)}
          </Text>
          <View style={styles.actions}>
            <Pressable
              testID="update-check-result-close"
              onPress={onClose}
              style={styles.btn}>
              <Text style={{color: tokens.textSecondary}}>关闭</Text>
            </Pressable>
            <Pressable
              testID="update-check-result-snooze"
              onPress={() => {
                void Promise.resolve(onSnoozeToday());
              }}
              style={styles.btn}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                今日不再提醒
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
