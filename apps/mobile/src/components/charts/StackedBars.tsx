/**
 * 纯 RN View 双段堆叠柱状图（数据统计页专用）。
 *
 * 下段为输入（primary）、上段为输出（secondary），柱高按全量数据归一化。
 * 不依赖 react-native-svg：柱宽按滚动区宽度自适应（柱数少时变宽），30 天数据
 * 超宽时由横向 ScrollView 自然滚动。
 *
 * 纵坐标三档刻度（对齐 desktop 语义）：max 顶 / max÷2 中 / 0 基线，每档
 * 「网格线 + 刻度值」。网格线在滚动内容层铺满内容宽（随内容滚动）；
 * 刻度值列在外层行布局右侧固定（宽约 36px），不随内容滚出视口。
 */
import React, {useCallback, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {formatTokenCount} from '@novel-master/core/common';
import type {ThemeTokens} from '@/theme/tokens';

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

/** 图表绘图区高度（px），柱高在此范围内归一化，网格线/刻度值也按它对齐。 */
const CHART_HEIGHT = 140;
/** 柱子最小宽度：30 天数据超宽时靠它撑出横向滚动。 */
const MIN_BAR_WIDTH = 18;
const BAR_GAP = 6;
/** 外置刻度值列宽度（px）：三档刻度值右对齐恒在视口内。 */
const GRID_LABEL_COLUMN_WIDTH = 36;

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
    (e: {nativeEvent: {layout: {width: number}}}) => {
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

  // 三档刻度（T-MC1）：max 顶 / max÷2 中 / 0 基线；top 百分比相对
  // CHART_HEIGHT 绘图区定位，线层（内容层）与刻度值列（外层）共用同一定义。
  // maxTotal === 0 时三档全显 0（除零安全），刻度值复用 formatTokenCount。
  // top 用模板字面量类型：RN 样式的 DimensionValue 不收宽 string。
  const gridTiers: readonly {
    tier: 'max' | 'mid' | 'zero';
    top: `${number}%`;
    translateY: number;
    text: string;
  }[] = [
    {
      tier: 'max' as const,
      top: '0%',
      // 文字整体抬到顶线上方，不压 max 线。
      translateY: -13,
      text: maxTotal > 0 ? formatTokenCount(maxTotal) : '0',
    },
    {
      tier: 'mid' as const,
      top: '50%',
      // 半行高下沉，文字中线贴 50% 线。
      translateY: -6,
      text: maxTotal > 0 ? formatTokenCount(Math.round(maxTotal / 2)) : '0',
    },
    {
      tier: 'zero' as const,
      top: '100%',
      // 文字落在基线下方，与滚动区内的 x 轴柱标签错列。
      translateY: -2,
      text: '0',
    },
  ];

  return (
    <View testID={testID}>
      <View style={styles.legendRow}>
        {[
          {label: '输入', color: tokens.primary},
          {label: '输出', color: tokens.textSecondary},
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: item.color}]} />
            <Text style={[styles.legendLabel, {color: tokens.textSecondary}]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.chartRow}>
        {/* 左侧滚动区：柱 + 网格线。onLayout 挂在 ScrollView 上，
            测量值即绘图区宽（不含右侧刻度列），柱宽公式输入不变。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chartScroll}
          onLayout={onLayout}
        >
          <View style={[styles.barsRow, {minWidth: containerWidth}]}>
            {/* 网格刻度层：绝对定位铺满内容宽（随内容滚动），不参与 flex 布局 */}
            <View
              testID={testID ? `${testID}-grid` : undefined}
              pointerEvents="none"
              style={styles.gridLayer}
            >
              {gridTiers.map(({tier, top}) => (
                <View
                  key={tier}
                  testID={`grid-line-${tier}`}
                  style={[
                    styles.gridLine,
                    {
                      top,
                      borderTopColor: tokens.borderLight,
                    },
                  ]}
                />
              ))}
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
                    style={{height: CHART_HEIGHT, justifyContent: 'flex-end'}}
                  >
                    {/* 无数据日期也保留等宽占位，列宽与有数据日期一致 */}
                    {height === 0 ? (
                      <View style={{width: barWidth, height: 0}} />
                    ) : (
                      <View
                        testID={`bar-${datum.key}`}
                        style={[
                          styles.bar,
                          {height, width: barWidth, overflow: 'hidden'},
                        ]}
                      >
                        <View
                          style={{flex: 1, backgroundColor: tokens.primary}}
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
                      {color: selected ? tokens.primary : tokens.textSecondary},
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
        {/* 右侧固定刻度值列：在横向 ScrollView 外，30 天超宽滚动时三档
          刻度值恒在视口内。 */}
        <View pointerEvents="none" style={styles.gridLabelColumn}>
          {gridTiers.map(({tier, top, translateY, text}) => (
            <Text
              key={tier}
              testID={`grid-label-${tier}`}
              style={[
                styles.gridLabel,
                {top, transform: [{translateY}], color: tokens.textTertiary},
              ]}
            >
              {text}
            </Text>
          ))}
        </View>
      </View>
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
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  chartScroll: {
    flex: 1,
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
  gridLabelColumn: {
    width: GRID_LABEL_COLUMN_WIDTH,
    height: CHART_HEIGHT,
    marginLeft: 4,
  },
  gridLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    fontSize: 10,
    textAlign: 'right',
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
