/**
 * Rename a saved model preset (`editSaved`).
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  initialModelName: string;
  onClose: () => void;
  onConfirm: (modelName: string) => Promise<void>;
};

export function EditModelNameModal({
  visible,
  initialModelName,
  onClose,
  onConfirm,
}: Props) {
  const {tokens} = useTheme();
  const [modelName, setModelName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setModelName(initialModelName);
    }
  }, [visible, initialModelName]);

  const handleConfirm = async () => {
    const trimmed = modelName.trim();
    if (!trimmed) {
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
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>重命名模型</Text>
          <Text style={[styles.label, {color: tokens.textSecondary}]}>
            模型名称
          </Text>
          <TextInput
            style={[
              styles.input,
              {color: tokens.text, borderColor: tokens.border},
            ]}
            value={modelName}
            onChangeText={setModelName}
            placeholder="模型名称"
            placeholderTextColor={tokens.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => handleConfirm().catch(() => undefined)}
              style={styles.btn}
              disabled={saving || !modelName.trim()}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                {saving ? '保存中…' : '保存'}
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
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
  },
  title: {fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 8},
  label: {fontSize: 13, marginTop: 4},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
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
  btn: {paddingVertical: 8, paddingHorizontal: 4},
});
