/**
 * Agent 流式生成计时与正/思考字数（不含 tool 参数）。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  buildChatStreamMetricsLine,
  type AgentStreamMetricsView,
} from '@/hooks/useAgentStreamMetrics';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  metrics: AgentStreamMetricsView;
  /**
   * 中断现场的冻结指标（Step 7）：为 true 时文案前缀「已中断 ·」——
   * PRD「状态为已中断」的正面可感知标识，不动 webview 协议。
   */
  readonly interrupted?: boolean;
};

export function ChatStreamMetricsBar({metrics, interrupted}: Props) {
  const {tokens} = useTheme();
  const line = buildChatStreamMetricsLine(metrics);

  return (
    <View style={[styles.bar, {backgroundColor: tokens.bgSecondary}]}>
      {interrupted ? (
        <Text style={[styles.badge, {color: tokens.danger}]}>已中断</Text>
      ) : null}
      <Text
        style={[styles.line, {color: tokens.textSecondary}]}
        numberOfLines={2}
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  badge: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  line: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
