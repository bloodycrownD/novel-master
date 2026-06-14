/**
 * Row selection checkbox for batch list mode.
 * 18px square aligns visually with WebView 20px round .batch-check.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  checked: boolean;
  onToggle: () => void;
  /** 勾选强调色；消息可见性批量用 danger，列表批量默认 primary */
  accentColor?: string;
};

export function BatchCheckbox({checked, onToggle, accentColor}: Props) {
  const {tokens} = useTheme();
  const accent = accentColor ?? tokens.primary;

  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      style={[
        styles.box,
        {
          borderColor: checked ? accent : tokens.border,
          backgroundColor: checked ? accent : 'transparent',
        },
      ]}>
      {checked ? <Text style={styles.mark}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  mark: {color: '#fff', fontSize: 11, fontWeight: '700'},
});
