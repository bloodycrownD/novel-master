/**
 * Page-footer batch bar (prototype list-batch-page-footer).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
};

export function ListBatchBar({selectedCount, onCancel, onDelete}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: tokens.surfaceElevated,
          borderTopColor: tokens.border,
        },
      ]}>
      <Pressable onPress={onCancel}>
        <Text style={{color: tokens.text}}>取消</Text>
      </Pressable>
      <Text style={{color: tokens.textSecondary}}>已选 {selectedCount} 项</Text>
      <Pressable onPress={onDelete} disabled={selectedCount === 0}>
        <Text
          style={{
            color: selectedCount > 0 ? tokens.danger : tokens.textTertiary,
          }}>
          删除
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
