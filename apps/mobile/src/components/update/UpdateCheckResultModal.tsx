/**
 * 自动更新检查结果首屏弹窗（已最新 / 检查失败）。
 *
 * 使用 react-native 原生 Modal，而非 AppModal：本组件由 App 根的
 * UpdateCheckHost 在 NavigationContainer 之外渲染，AppModal 依赖 useIsFocused() 会触发
 * "Couldn't find a navigation object" 崩溃。应用级首屏弹窗无需 focus gate。
 */
import React from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';
import {coreT} from '@/i18n/core';
import type {UpdateCheckResultKind} from '@/services/update-check-flow';

export type {UpdateCheckResultKind};

const UPDATE_CHECK_RESULT_TITLE = coreT({key: "ui.update.check_title"});
const UPDATE_CHECK_UP_TO_DATE_MESSAGE = coreT({key: "ui.update.up_to_date"});
const UPDATE_CHECK_FAILED_MESSAGE = coreT({key: "ui.update.check_failed"});

type Props = {
  visible: boolean;
  kind: UpdateCheckResultKind;
  onClose: () => void;
  onSnoozeToday: () => void | Promise<void>;
};

export function UpdateCheckResultModal({visible, kind, onClose, onSnoozeToday}: Props) {
  const {tokens} = useTheme();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.panel, {backgroundColor: tokens.surface}]} onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>{UPDATE_CHECK_RESULT_TITLE}</Text>
          <Text style={[styles.message, {color: tokens.textSecondary}]}>{kind === 'up-to-date' ? UPDATE_CHECK_UP_TO_DATE_MESSAGE : UPDATE_CHECK_FAILED_MESSAGE}</Text>
          <View style={styles.actions}>
            <Pressable testID="update-check-result-close" onPress={onClose} style={styles.btn}>
              <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.close"})}</Text>
            </Pressable>
            <Pressable
              testID="update-check-result-snooze"
              onPress={() => {
                void Promise.resolve(onSnoozeToday());
              }}
              style={styles.btn}
            >
              <Text style={{color: tokens.primary, fontWeight: '600'}}>{coreT({key: "ui.update.remind_off_today"})}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
    justifyContent: 'space-between',
    gap: 16,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
