/**
 * Run timer and streamed character counts (proxy for token throughput).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  formatCharCount,
  formatStreamElapsed,
  type AgentStreamMetricsView,
} from '../../hooks/useAgentStreamMetrics';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  metrics: AgentStreamMetricsView;
};

export function ChatStreamMetricsBar({metrics}: Props) {
  const {tokens} = useTheme();
  const elapsedSec = metrics.elapsedMs / 1000;
  const elapsedLabel = formatStreamElapsed(elapsedSec);
  const rate =
    metrics.charsPerSecond >= 10
      ? Math.round(metrics.charsPerSecond)
      : Math.round(metrics.charsPerSecond * 10) / 10;

  const prefix = metrics.running ? '生成中' : '上次生成';

  const parts: string[] = [
    `${prefix} · ${elapsedLabel}`,
    `正文 ${formatCharCount(metrics.textChars)} 字`,
  ];
  if (metrics.thinkingChars > 0) {
    parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
  }
  if (metrics.totalChars > 0 && elapsedSec > 0) {
    parts.push(`${rate} 字/秒`);
  }

  return (
    <View style={[styles.bar, {backgroundColor: tokens.bgSecondary}]}>
      <Text
        style={[styles.line, {color: tokens.textSecondary}]}
        numberOfLines={2}>
        {parts.join(' · ')}
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
