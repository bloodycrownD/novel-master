/**
 * Session actions drawer: read-only current agent/model + action rows.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveCurrentAgentDisplayLabel} from '../../services/agent-display-label';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRename?: () => void;
  onCompact?: () => void;
  onSwitchModel?: () => void;
  onSwitchAgent?: () => void;
  onRealPrompt?: () => void;
  onBatchDeleteMessages?: () => void;
  onBatchHideMessages?: () => void;
  onBatchUnhideMessages?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onRename,
  onCompact,
  onSwitchModel,
  onSwitchAgent,
  onRealPrompt,
  onBatchDeleteMessages,
  onBatchHideMessages,
  onBatchUnhideMessages,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [agentLabel, setAgentLabel] = useState('—');
  const [modelLabel, setModelLabel] = useState('—');

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    (async () => {
      const agent = await resolveCurrentAgentDisplayLabel(runtime);
      if (cancelled) {
        return;
      }
      setAgentLabel(agent);

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
        setAgentLabel('—');
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
    {label: '切换 agent', action: onSwitchAgent},
    {label: '真实提示词', action: onRealPrompt},
    {label: '压缩会话', action: onCompact},
    {label: '批量删除消息', action: onBatchDeleteMessages},
    {label: '批量隐藏消息', action: onBatchHideMessages},
    {label: '批量取消隐藏', action: onBatchUnhideMessages},
  ];

  return (
    <AppModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
          <View style={[styles.infoBlock, {borderBottomColor: tokens.border}]}>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, {color: tokens.textSecondary}]}>
                当前 agent
              </Text>
              <Text
                style={[styles.infoValue, {color: tokens.textSecondary}]}
                numberOfLines={1}
                ellipsizeMode="middle">
                {agentLabel}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, {color: tokens.textSecondary}]}>
                当前模型
              </Text>
              <Text
                style={[styles.infoValue, {color: tokens.textSecondary}]}
                numberOfLines={1}
                ellipsizeMode="middle">
                {modelLabel}
              </Text>
            </View>
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
    </AppModal>
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
  infoBlock: {
    gap: 8,
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {fontSize: 14, flexShrink: 0},
  infoValue: {fontSize: 14, flex: 1, textAlign: 'right'},
  row: {paddingVertical: 14},
});
