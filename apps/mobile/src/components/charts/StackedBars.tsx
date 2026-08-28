/**
 * 纯 RN View 双段堆叠柱状图（数据统计页专用）。
 *
 * 下段为输入（primary）、上段为输出（secondary），柱高按全量数据归一化。
 * 不依赖 react-native-svg：柱宽按容器宽度自适应（柱数少时变宽），30 天数据
 * 超宽时由横向 ScrollView 自然滚动。
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatTokenCount } from '@novel-master/core/common';
import type { ThemeTokens } from '../../theme/tokens';

export interface StackedBarsDatum {
  key: string;
  /** 输入 token（柱下半段）。 */
  primary: number;
  /** 输出 token（柱上半段，缺省 0）。 */
  secondary?: number;
  /** 调用次数（供无障碍标签，缺省不展示该段）。 */
  calls?: number;
}

type Props = {
  data: readonly StackedBarsDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  /** 长按柱子回调（静置 500ms 触发、滚动即取消，与横向 ScrollView 不互抢）。 */
  onLongPress?: (key: string) => void;
  tokens: ThemeTokens;
  /** x 轴标签（缺省用 key 原文）。 */
  formatLabel?: (key: string, index: number) => string;
  testID?: string;
};

/** 图表绘图区高度（px），柱高在此范围内归一化。 */
const CHART_HEIGHT = 140;
/** 柱子最小宽度：30 天数据超宽时靠它撑出横向滚动。 */
const MIN_BAR_WIDTH = 18;
const BAR_GAP = 6;

export function StackedBars({
  data,
  selectedKey,
  onSelect,
  onLongPress,
  tokens,
  formatLabel,
  testID,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      setContainerWidth(e.nativeEvent.layout.width);
    },
    [],
  );

  const barWidth =
    containerWidth > 0 && data.length > 0
      ? Math.max(
          MIN_BAR_WIDTH,
          Math.floor(
            (containerWidth - BAR_GAP * (data.length - 1)) / data.length,
          ),
        )
      : MIN_BAR_WIDTH;

  const maxTotal = data.reduce((max, d) => {
    const total = d.primary + (d.secondary ?? 0);
    return total > max ? total : max;
  }, 0);

  return (
    <View testID={testID} onLayout={onLayout}>
      <View style={styles.legendRow}>
        {[
          { label: '输入', color: tokens.primary },
          { label: '输出', color: tokens.textSecondary },
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={[styles.legendLabel, { color: tokens.textSecondary }]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.barsRow, { minWidth: containerWidth }]}>
          {/* 网格刻度层：绝对定位覆盖绘图区，不参与 flex 布局 */}
          <View testID={testID ? `${testID}-grid` : undefined} pointerEvents="none" style={styles.gridLayer}>
            {[1, 2].map(line => (
              <View
                key={line}
                testID={`grid-line-${line}`}
                style={[
                  styles.gridLine,
                  { top: `${(line / 3) * 100}%`, borderTopColor: tokens.borderLight },
                ]}
              />
            ))}
            <Text
              testID="grid-max-label"
              style={[styles.gridMaxLabel, { color: tokens.textTertiary }]}
            >
              {formatTokenCount(maxTotal)}
            </Text>
          </View>
          {data.map((datum, index) => {
            const selected = datum.key === selectedKey;
            const label = formatLabel
              ? formatLabel(datum.key, index)
              : datum.key;
            const total = datum.primary + (datum.secondary ?? 0);
            const height =
              maxTotal > 0 && total > 0
                ? Math.max(2, Math.round((total / maxTotal) * CHART_HEIGHT))
                : 0;
            const primaryHeight =
              height > 0 && total > 0
                ? Math.max(1, Math.round((datum.primary / total) * height))
                : 0;
            const secondaryHeight = height - primaryHeight;
            // 读屏文案与 desktop 侧 bucketTooltip 同口径：日期 · 输入 · 输出 · 调用次数。
            const barA11yLabel = [
              label,
              `输入 ${formatTokenCount(datum.primary)}`,
              `输出 ${formatTokenCount(datum.secondary ?? 0)}`,
              ...(datum.calls != null ? [`调用 ${datum.calls} 次`] : []),
            ].join(' · ');
            return (
              <Pressable
                key={datum.key}
                testID={`bar-col-${datum.key}`}
                onPress={onSelect ? () => onSelect(datum.key) : undefined}
                onLongPress={
                  onLongPress ? () => onLongPress(datum.key) : undefined
                }
                // 仅可点选的柱子（如按天图）标 button；无 onSelect 的柱子
                // 标成 button 会让读屏用户以为可激活（参照 desktop/J-1 的教训）。
                accessibilityRole={onSelect ? 'button' : undefined}
                accessibilityLabel={barA11yLabel}
                style={styles.barCol}
              >
                <View
                  style={{ height: CHART_HEIGHT, justifyContent: 'flex-end' }}
                >
                  {height === 0 ? null : (
                    <View
                      testID={`bar-${datum.key}`}
                      style={[
                        styles.bar,
                        { height, width: barWidth, overflow: 'hidden' },
                      ]}
                    >
                      <View
                        style={{ flex: 1, backgroundColor: tokens.primary }}
                      />
                      {secondaryHeight > 0 ? (
                        <View
                          style={{
                            height: secondaryHeight,
                            backgroundColor: tokens.textSecondary,
                          }}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
                <Text
                  testID={`bar-label-${datum.key}`}
                  style={[
                    styles.barLabel,
                    { color: selected ? tokens.primary : tokens.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 12,
  },
  barsRow: {
    flexDirection: 'row',
    gap: BAR_GAP,
    alignItems: 'flex-end',
    // 柱总宽小于容器（minWidth: containerWidth）时水平居中，修贴左根因；
    // 超宽时内容宽大于 minWidth，justifyContent 不生效，横向滚动原样保留。
    justifyContent: 'center',
  },
  gridLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CHART_HEIGHT,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
  },
  gridMaxLabel: {
    position: 'absolute',
    top: 2,
    right: 0,
    fontSize: 10,
  },
  barCol: {
    alignItems: 'center',
    gap: 4,
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barLabel: {
    fontSize: 11,
  },
});
