/**
 * Chat message edit dialog only. Enter inserts a newline; save is via the button only.
 * Aligns multiline input behavior with ChatComposer (no returnKeyType done / onSubmitEditing).
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const inputMaxHeight = useMemo(() => {
    const windowHeight = Dimensions.get('window').height;
    // Leave room for title, label, actions, padding, and keyboard (resize/adjust).
    return Math.min(240, Math.max(INPUT_MIN_HEIGHT, windowHeight * 0.28));
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

  // AndroidManifest uses adjustResize; extra KAV "height" shrinks the panel and overflows children.
  const keyboardBehavior =
    Platform.OS === 'ios' ? ('padding' as const) : undefined;

  return (
    <AppModal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={keyboardBehavior}
        style={styles.avoidingRoot}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}>
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
            <ScrollView
              style={[styles.inputScroll, {maxHeight: inputMaxHeight}]}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: tokens.text,
                    borderColor: tokens.border,
                    backgroundColor: tokens.background,
                    minHeight: INPUT_MIN_HEIGHT,
                  },
                ]}
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={tokens.textSecondary}
                autoFocus
                autoCorrect={false}
                multiline
                blurOnSubmit={false}
                scrollEnabled={false}
                textAlignVertical="top"
              />
            </ScrollView>
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
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  avoidingRoot: {
    flex: 1,
  },
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
    maxHeight: '85%',
    overflow: 'hidden',
  },
  inputScroll: {
    flexGrow: 0,
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
