/**
 * Single-line text prompt (create/rename dialogs).
 */
import React, {useEffect, useState} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {useTheme} from '@/theme/ThemeProvider';
import {useAndroidModalKeyboardAvoid} from '@/hooks/useAndroidModalKeyboardAvoid';
import {AppModal} from './AppModal';

type Props = {
  visible: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
};

export function TextPromptModal({
  visible,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = '确定',
  onClose,
  onConfirm,
}: Props) {
  const {tokens} = useTheme();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  // Android Modal 是独立 window，useReanimatedKeyboardAnimation 走 native event emitter
  // 在 Modal 内也能正常收事件。只给面板加 translateY，遮罩不动，不触发 flex layout。
  // 居中弹窗上移键盘高度的一半，露出输入框又不顶到屏幕顶部。
  const panelAvoidStyle = useAndroidModalKeyboardAvoid(0.5);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // backdrop + panel：iOS 走 KeyboardAvoidingView 包裹，Android 在 panel 上挂 translateY。
  // Android 上 react-native-keyboard-controller 的 KeyboardAvoidingView behavior={undefined}
  // 等于啥也不干，所以改用 Animated.View + useAndroidModalKeyboardAvoid 自己避让。
  const backdrop = (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Animated.View
        style={[
          styles.panel,
          {backgroundColor: tokens.surface},
          Platform.OS === 'android' ? panelAvoidStyle : undefined,
        ]}
        onStartShouldSetResponder={() => true}
      >
        <Pressable onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
          {label ? (
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              {label}
            </Text>
          ) : null}
          <TextInput
            testID="text-prompt-input"
            style={[
              styles.input,
              {
                color: tokens.text,
                borderColor: tokens.border,
                backgroundColor: tokens.background,
              },
            ]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={tokens.textSecondary}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => handleConfirm().catch(() => undefined)}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable
              testID="text-prompt-submit"
              onPress={() => handleConfirm().catch(() => undefined)}
              style={styles.btn}
              disabled={!canSubmit}
            >
              <Text
                style={{
                  color: canSubmit ? tokens.primary : tokens.textTertiary,
                  fontWeight: '600',
                }}
              >
                {saving ? '保存中…' : confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Animated.View>
    </Pressable>
  );

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.avoidingRoot}
          keyboardVerticalOffset={24}
        >
          {backdrop}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.avoidingRoot}>{backdrop}</View>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // 背景色放在 avoidingRoot：键盘弹起后底部不会透出白条，backdrop 不再单独设背景色。
  avoidingRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 16,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
