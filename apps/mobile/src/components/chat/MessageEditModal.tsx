/**
 * 聊天消息编辑弹窗。回车换行；仅按钮保存。
 * 多行输入对齐 ChatComposer 模式（TextInput 直挂 min/maxHeight），禁止 ScrollView 包裹。
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '@/theme/ThemeProvider';
import {AppModal} from '@/components/ui/AppModal';

const INPUT_MIN_HEIGHT = 120;

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

export function MessageEditModal({
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
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const inputMaxHeight = useMemo(() => {
    const windowHeight = Dimensions.get('window').height;
    // 为标题、标签、操作栏、padding 与键盘留出空间
    return Math.min(280, windowHeight * 0.32);
  }, []);

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

  const modalBody = (
    <Pressable
      style={[styles.backdrop, {paddingBottom: 24 + insets.bottom}]}
      onPress={onClose}>
      <Pressable
        style={[styles.panel, {backgroundColor: tokens.surface}]}
        onPress={e => e.stopPropagation()}>
        <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
        {label ? (
          <Text style={[styles.label, {color: tokens.textSecondary}]}>
            {label}
          </Text>
        ) : null}
        <TextInput
          style={[
            styles.input,
            {
              color: tokens.text,
              borderColor: tokens.border,
              backgroundColor: tokens.background,
              minHeight: INPUT_MIN_HEIGHT,
              maxHeight: inputMaxHeight,
            },
          ]}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={tokens.textSecondary}
          autoFocus
          autoCorrect={false}
          multiline
          submitBehavior="newline"
          textAlignVertical="top"
        />
        <View style={styles.actions}>
          <Pressable onPress={onClose} style={styles.btn}>
            <Text style={{color: tokens.textSecondary}}>取消</Text>
          </Pressable>
          <Pressable
            onPress={() => handleConfirm().catch(() => undefined)}
            style={styles.btn}
            disabled={!canSubmit}>
            <Text
              style={{
                color: canSubmit ? tokens.primary : tokens.textTertiary,
                fontWeight: '600',
              }}>
              {saving ? '保存中…' : confirmLabel}
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      {Platform.OS === 'ios' ? (
        // iOS Modal 与键盘不同步，用 padding 行为避让
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.avoidingRoot}
          keyboardVerticalOffset={24}>
          {modalBody}
        </KeyboardAvoidingView>
      ) : (
        // AndroidManifest adjustResize 已托底；叠加 KAV height 会双重收缩 panel
        modalBody
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  avoidingRoot: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    overflow: 'hidden',
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
