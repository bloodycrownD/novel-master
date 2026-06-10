/**
 * Session actions drawer: rename, prompt preview, compaction, batch ops.
 * Agent/model selection lives under Profile → 我的.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRename?: () => void;
  onCompact?: () => void;
  onRealPrompt?: () => void;
  onBatchMessages?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onRename,
  onCompact,
  onRealPrompt,
  onBatchMessages,
}: Props) {
  const {tokens} = useTheme();

  const items = [
    {label: '聊天重命名', action: onRename},
    {label: '查看提示词', action: onRealPrompt},
    {label: '压缩上下文', action: onCompact},
    {label: '批量操作', action: onBatchMessages},
  ];

  return (
    <AppModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
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
  row: {paddingVertical: 14},
});
