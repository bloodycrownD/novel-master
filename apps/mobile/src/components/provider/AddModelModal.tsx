/**
 * Register a saved model under a provider (vendorModelId + optional model name).
 */
import React, {useEffect, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (vendorModelId: string, modelName?: string) => Promise<void>;
};

export function AddModelModal({visible, onClose, onConfirm}: Props) {
  const {tokens} = useTheme();
  const [vendorModelId, setVendorModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setVendorModelId('');
      setModelName('');
    }
  }, [visible]);

  const handleConfirm = async () => {
    const vendor = vendorModelId.trim();
    if (!vendor) {
      return;
    }
    setSaving(true);
    try {
      const label = modelName.trim() || undefined;
      await onConfirm(vendor, label);
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoidingRoot}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, {color: tokens.text}]}>添加模型</Text>
          <Text style={[styles.label, {color: tokens.textSecondary}]}>
            厂商模型 ID
          </Text>
          <TextInput
            style={[
              styles.input,
              {color: tokens.text, borderColor: tokens.border},
            ]}
            value={vendorModelId}
            onChangeText={setVendorModelId}
            placeholder="如 gpt-4o"
            placeholderTextColor={tokens.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.label, {color: tokens.textSecondary}]}>
            模型名称（可选）
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
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => handleConfirm().catch(() => undefined)}
              style={styles.btn}
              disabled={saving || !vendorModelId.trim()}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                {saving ? '保存中…' : '添加'}
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
  // 背景色放在 avoidingRoot：KeyboardAvoidingView 加的 paddingBottom 区域
  // 也属于 avoidingRoot 的 padding box，会被 backgroundColor 覆盖，
  // 这样键盘弹起后底部不会透出白条。backdrop 不再单独设背景色。
  avoidingRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
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
