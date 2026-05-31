/**
 * Session actions drawer (modal shell; M1 placeholder menu items).
 */
import React from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
  onRealPrompt?: () => void;
  onSessionLog?: () => void;
};

export function SessionActionsDrawer({
  visible,
  onClose,
  onRealPrompt,
  onSessionLog,
}: Props) {
  const {tokens} = useTheme();

  const items = [
    {label: '真实提示词', action: onRealPrompt},
    {label: '会话日志', action: onSessionLog},
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.panel, {backgroundColor: tokens.surface}]}>
          <Text style={[styles.heading, {color: tokens.text}]}>会话操作</Text>
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
        </View>
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
  row: {paddingVertical: 14},
});
