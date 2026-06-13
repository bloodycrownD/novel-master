/**
 * Run timer and streamed character counts (proxy for token throughput).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  buildChatStreamMetricsLine,
  type AgentStreamMetricsView,
} from '../../hooks/useAgentStreamMetrics';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  metrics: AgentStreamMetricsView;
};

export function ChatStreamMetricsBar({metrics}: Props) {
  const {tokens} = useTheme();
  const line = buildChatStreamMetricsLine(metrics);

  return (
    <View style={[styles.bar, {backgroundColor: tokens.bgSecondary}]}>
      <Text
        style={[styles.line, {color: tokens.textSecondary}]}
        numberOfLines={2}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  line: {
    fontSize: 12,
    lineHeight: 17,
  },
});
