/**
 * Turn-level tool execution phase hint (no per-tool cards yet).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  embedded?: boolean;
};

export function ToolTurnPhaseBar({embedded = true}: Props) {
  const {tokens} = useTheme();
  return (
    <View style={embedded ? styles.embedded : styles.standalone}>
      <Text style={[styles.label, {color: tokens.textSecondary}]}>
        正在执行工具调用…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  embedded: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  standalone: {
    marginVertical: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
