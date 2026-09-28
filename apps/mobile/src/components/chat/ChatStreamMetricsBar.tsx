/**
 * Agent 流式生成计时与正/思考字数（不含 tool 参数）。
 *
 * metric-detail-sheet：外包 Pressable（onPress 可选，pressed 降透明度——
 * ChatMetaBar 先例）；不传 onPress 时维持纯展示（disabled）。metrics 渲染
 * 逻辑不变，弹窗数据由 MetricDetailSheet 打开时自取（不进本组件 props）。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
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
  /** 点击指标条打开用量详情 sheet（metric-detail-sheet）；不传则禁用按压。 */
  readonly onPress?: () => void;
};

export function ChatStreamMetricsBar({
  metrics,
  interrupted,
  onPress,
}: Props) {
  const {tokens} = useTheme();
  const line = buildChatStreamMetricsLine(metrics);

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`流式指标，${line}`}
      style={({pressed}) => [
        styles.bar,
        {backgroundColor: tokens.bgSecondary},
        pressed && styles.pressed,
      ]}
    >
      {interrupted ? (
        <Text style={[styles.badge, {color: tokens.danger}]}>已中断</Text>
      ) : null}
      <Text
        style={[styles.line, {color: tokens.textSecondary}]}
        numberOfLines={2}
      >
        {line}
      </Text>
    </Pressable>
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
  pressed: {opacity: 0.5},
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
