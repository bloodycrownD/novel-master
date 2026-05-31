/**
 * Session actions drawer (modal shell; M1 menu + current workspace model label).
 */
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSwitchModel?: () => void;
  onRealPrompt?: () => void;
  onSessionLog?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onSwitchModel,
  onRealPrompt,
  onSessionLog,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [modelLabel, setModelLabel] = useState('—');

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    (async () => {
      const modelId = await runtime.state.getCurrentModelId();
      if (cancelled) {
        return;
      }
      if (!modelId) {
        setModelLabel('未选择');
        return;
      }
      try {
        setModelLabel(await resolveModelDisplayLabel(runtime, modelId));
      } catch {
        setModelLabel(modelId);
      }
    })().catch(() => {
      if (!cancelled) {
        setModelLabel('—');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, runtime]);

  const items = [
    {label: '切换模型', action: onSwitchModel},
    {label: '真实提示词', action: onRealPrompt},
    {label: '会话日志', action: onSessionLog},
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.panel, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.heading, {color: tokens.text}]}>会话操作</Text>
          <View style={[styles.modelRow, {borderBottomColor: tokens.border}]}>
            <Text style={[styles.modelCaption, {color: tokens.textSecondary}]}>
              当前模型
            </Text>
            <Text
              style={[styles.modelValue, {color: tokens.text}]}
              numberOfLines={2}>
              {modelLabel}
            </Text>
          </View>
          {items.map(item => (
            <Pressable
              key={item.label}
              style={styles.row}
              onPress={() => {
                item.action?.();
                onClose();
              }}>
              <Text style={{color: tokens.text}}>{item.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  panel: {padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16},
  heading: {fontSize: 16, fontWeight: '600', marginBottom: 8},
  modelRow: {
    paddingVertical: 12,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelCaption: {fontSize: 12, marginBottom: 4},
  modelValue: {fontSize: 15, fontWeight: '500'},
  row: {paddingVertical: 14},
});
