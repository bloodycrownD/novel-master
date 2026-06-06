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
};

export function BatchCheckbox({checked, onToggle}: Props) {
  const {tokens} = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      style={[
        styles.box,
        {
          borderColor: checked ? tokens.primary : tokens.border,
          backgroundColor: checked ? tokens.primary : 'transparent',
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
