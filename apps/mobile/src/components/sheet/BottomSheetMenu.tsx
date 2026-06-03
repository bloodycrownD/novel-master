/**
 * Simple action sheet (Modal) aligned with prototype bottom sheet menus.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppModal} from '../ui/AppModal';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.surface,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}>
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
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
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
