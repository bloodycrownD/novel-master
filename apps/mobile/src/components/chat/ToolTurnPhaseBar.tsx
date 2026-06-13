/**
 * Turn-level tool execution phase hint (no per-tool cards yet).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  embedded?: boolean;
  /** 默认「正在执行工具调用…」；stream tail 传「工具调用中」。 */
  label?: string;
};

export function ToolTurnPhaseBar({
  embedded = true,
  label = '正在执行工具调用…',
}: Props) {
  const {tokens} = useTheme();
  return (
    <View style={embedded ? styles.embedded : styles.standalone}>
      <Text style={[styles.label, {color: tokens.textSecondary}]}>
        {label}
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
