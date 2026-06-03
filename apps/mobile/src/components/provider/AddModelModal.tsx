/**
 * Register a saved model under a provider (vendorModelId + optional display name).
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (vendorModelId: string, displayName?: string) => Promise<void>;
};

export function AddModelModal({visible, onClose, onConfirm}: Props) {
  const {tokens} = useTheme();
  const [vendorModelId, setVendorModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setVendorModelId('');
      setDisplayName('');
    }
  }, [visible]);

  const handleConfirm = async () => {
    const vendor = vendorModelId.trim();
    if (!vendor) {
      return;
    }
    setSaving(true);
    try {
      const label = displayName.trim() || undefined;
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
            显示名称（可选）
          </Text>
          <TextInput
            style={[
              styles.input,
              {color: tokens.text, borderColor: tokens.border},
            ]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="留空则使用厂商 ID"
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
