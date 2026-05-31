/**
 * Session actions drawer: read-only current model + action rows.
 */
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRename?: () => void;
  onSwitchModel?: () => void;
  onRealPrompt?: () => void;
  onSessionLog?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onRename,
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
    {label: '重命名', action: onRename},
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
          <View style={[styles.modelInfo, {borderBottomColor: tokens.border}]}>
            <Text style={[styles.modelInfoLabel, {color: tokens.textSecondary}]}>
              当前模型
            </Text>
            <Text
              style={[styles.modelInfoValue, {color: tokens.textSecondary}]}
              numberOfLines={1}
              ellipsizeMode="middle">
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
  modelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelInfoLabel: {fontSize: 14, flexShrink: 0},
  modelInfoValue: {fontSize: 14, flex: 1, textAlign: 'right'},
  row: {paddingVertical: 14},
});
