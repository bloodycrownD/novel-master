/**
 * Simple action sheet (Modal) aligned with prototype bottom sheet menus.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

export interface SheetMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

type Props = {
  visible: boolean;
  title?: string;
  items: SheetMenuItem[];
  onSelect: (action: string) => void;
  onClose: () => void;
};

export function BottomSheetMenu({
  visible,
  title,
  items,
  onSelect,
  onClose,
}: Props) {
  const {tokens} = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          {title ? (
            <Text style={[styles.title, {color: tokens.textSecondary}]}>
              {title}
            </Text>
          ) : null}
          {items.map(item => (
            <Pressable
              key={item.action}
              style={[styles.item, {borderTopColor: tokens.border}]}
              onPress={() => {
                onClose();
                onSelect(item.action);
              }}>
              <Text
                style={{
                  color: item.danger ? tokens.danger : tokens.text,
                  fontSize: 16,
                }}>
                {item.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.item, {borderTopColor: tokens.border}]}
            onPress={onClose}>
            <Text style={{color: tokens.textSecondary, fontSize: 16}}>
              取消
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
    paddingBottom: 24,
  },
  title: {
    textAlign: 'center',
    paddingVertical: 12,
    fontSize: 13,
  },
  item: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
