/**
 * Stream tail 工具调用阶段提示（与思考块分隔，带脉冲指示）。
 */
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  embedded?: boolean;
  /** 默认「工具调用中」。 */
  label?: string;
};

export function ToolTurnPhaseBar({
  embedded = true,
  label = '工具调用中',
}: Props) {
  const {tokens} = useTheme();
  return (
    <View
      style={[
        embedded ? styles.embedded : styles.standalone,
        {
          borderTopColor: tokens.borderLight,
        },
      ]}>
      <ActivityIndicator size="small" color={tokens.primary} />
      <Text style={[styles.label, {color: tokens.primary}]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  embedded: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  standalone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
