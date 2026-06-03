/**
 * Single-line text prompt (create/rename dialogs).
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
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
