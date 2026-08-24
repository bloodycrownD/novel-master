/**
 * 纯 RN View 柱状图（数据统计页专用）。
 *
 * - `usage` 模式：双段堆叠柱（下段输入 primary、上段输出 secondary），高度按
 *   全量数据归一化；
 * - `hitRate` 模式：单值柱（primary 传 0-100 百分比），高度按 100% 满刻度；
 *   无 cache 数据的桶高度为 0，用浅色底座与「真 0%」区分。
 *
 * 不依赖 react-native-svg：柱宽按容器宽度自适应（柱数少时变宽），30 天数据
 * 超宽时由横向 ScrollView 自然滚动。
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ThemeTokens } from '../../theme/tokens';

export interface StackedBarsDatum {
  key: string;
  /** usage 模式 = 输入 token；hitRate 模式 = 命中率百分比（0-100）。 */
  primary: number;
  /** usage 模式 = 输出 token；hitRate 模式忽略。 */
  secondary?: number;
  /** hitRate 模式下标记「无 cache 数据」的桶（高度 0 且视觉区分于 0%）。 */
  noData?: boolean;
}

type Props = {
  data: readonly StackedBarsDatum[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  tokens: ThemeTokens;
  mode: 'usage' | 'hitRate';
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
  tokens,
  mode,
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
    const total =
      mode === 'usage'
        ? d.primary + (d.secondary ?? 0)
        : Math.max(d.primary, 0);
    return total > max ? total : max;
  }, 0);

  const legend =
    mode === 'usage'
      ? [
          { label: '输入', color: tokens.primary },
          { label: '输出', color: tokens.textSecondary },
        ]
      : [{ label: '命中率', color: tokens.success }];

  return (
    <View testID={testID} onLayout={onLayout}>
      <View style={styles.legendRow}>
        {legend.map(item => (
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
          {data.map((datum, index) => {
            const selected = datum.key === selectedKey;
            const label = formatLabel
              ? formatLabel(datum.key, index)
              : datum.key;
            let barContent: React.ReactNode;
            if (mode === 'usage') {
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
              barContent =
                height === 0 ? null : (
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
                );
            } else {
              // hitRate：无数据桶高度 0（浅色底座标记）；有数据按百分比取高。
              const pct = Math.min(100, Math.max(0, datum.primary));
              const height = datum.noData
                ? 2
                : Math.max(2, Math.round((pct / 100) * CHART_HEIGHT));
              barContent = (
                <View
                  testID={`bar-${datum.key}`}
                  style={[
                    styles.bar,
                    {
                      height,
                      width: barWidth,
                      backgroundColor: datum.noData
                        ? tokens.borderLight
                        : tokens.success,
                      opacity: datum.noData ? 0.6 : 1,
                    },
                  ]}
                />
              );
            }
            return (
              <Pressable
                key={datum.key}
                testID={`bar-col-${datum.key}`}
                onPress={onSelect ? () => onSelect(datum.key) : undefined}
                style={styles.barCol}
              >
                <View
                  style={{ height: CHART_HEIGHT, justifyContent: 'flex-end' }}
                >
                  {barContent}
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
