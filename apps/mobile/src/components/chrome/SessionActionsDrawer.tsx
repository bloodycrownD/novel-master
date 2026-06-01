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
  onBatchDeleteMessages?: () => void;
  onBatchHideMessages?: () => void;
  onBatchUnhideMessages?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onRename,
  onSwitchModel,
  onRealPrompt,
  onSessionLog,
  onBatchDeleteMessages,
  onBatchHideMessages,
  onBatchUnhideMessages,
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
    {label: '批量删除消息', action: onBatchDeleteMessages},
    {label: '批量隐藏消息', action: onBatchHideMessages},
    {label: '批量取消隐藏', action: onBatchUnhideMessages},
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
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
                onClose();
                item.action?.();
              }}
              disabled={item.action == null}>
              <Text
                style={{
                  color: item.action == null ? tokens.textTertiary : tokens.text,
                }}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  panel: {
    padding: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
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
