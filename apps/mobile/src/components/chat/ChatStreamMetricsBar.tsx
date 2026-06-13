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

  const prefix = metrics.running
    ? metrics.streamKind === 'tool'
      ? '工具调用生成中'
      : '生成中'
    : '上次生成';

  let line: string;

  if (metrics.streamKind === 'tool') {
    const parts = [
      `${prefix} · ${elapsedLabel}`,
      `工具参数 ${formatCharCount(metrics.toolUseChars)} 字`,
    ];
    if (metrics.toolUseChars > 0 && elapsedSec > 0) {
      parts.push(`${rate} 字/秒`);
    }
    line = parts.join(' · ');
  } else if (metrics.streamKind === 'mixed') {
    const parts = [`${prefix} · 正文 ${formatCharCount(metrics.textChars)} 字`];
    if (metrics.thinkingChars > 0) {
      parts.push(`思考 ${formatCharCount(metrics.thinkingChars)} 字`);
    }
    parts.push(`工具参数 ${formatCharCount(metrics.toolUseChars)} 字`);
    line = parts.join(' · ');
  } else {
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
    line = parts.join(' · ');
  }

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
