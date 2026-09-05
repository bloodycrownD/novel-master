/**
 * 服务商×模型用量占比饼图（数据统计页汇总页签专用，react-native-svg）。
 *
 * - 数据行由调用方原样传入、不折叠（扇区数天然有界，由统计行的
 *   provider×model 组合数决定）；
 * - 扇区与图例均可点选（svg 元素用原生 onPress、图例行用 Pressable），
 *   小扇区即使难以点中也可从图例命中；点选后图正下方固定详情行展示
 *   用量 / 调用次数 / 占比（沿用 bar-inspect 惯例，规避浮层手势冲突）；
 * - 占比分母由调用方传入窗口 summary.totalTokens（P1-3，与旧列表口径一致）；
 * - 色板为固定循环色板（P2-5）：色相序列与桌面端一致（蓝→青→绿→黄→
 *   橙→红→紫→灰蓝，按传入顺序即用量降序分配）；蓝/绿/橙/红四位取主题
 *   tokens 语义色（亮暗自适应），青/黄/紫/灰蓝四位为与桌面同族的
 *   固定色值，超长后取模复用。
 */
import React, {useMemo, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {formatTokenCount} from '@novel-master/core/common';
import type {ThemeTokens} from '@/theme/tokens';
import {styles} from '@/screens/stack/token-usage/styles';

/** 饼图数据行：调用方（SummaryTab）排好序原样传入，组件不折叠不改序。 */
export interface PieChartDatum {
  /** 稳定键（扇区/图例 testID 与选中比对共用）。 */
  key: string;
  /** 展示名（{服务商} · {模型} 等三态组合，由调用方兑底）。 */
  label: string;
  totalTokens: number;
  calls: number;
}

/** 色板固定四色（青/黄/紫/灰蓝）：与桌面 shell.css 同族同序的补充位，
 * 亮暗背景下均可读；其余四位（蓝/绿/橙/红）由 tokens 语义色提供。 */
const PIE_PALETTE_FIXED = {
  teal: '#009FB8',
  yellow: '#C9970A',
  purple: '#7C56C9',
  slate: '#64748B',
} as const;

/** 固定循环色板（P2-5，与桌面同序：蓝→青→绿→黄→橙→红→紫→灰蓝）：
 * 索引超长后取模复用。 */
export function pieChartColors(t: ThemeTokens): string[] {
  return [
    t.primary,
    PIE_PALETTE_FIXED.teal,
    t.success,
    PIE_PALETTE_FIXED.yellow,
    t.warning,
    t.danger,
    PIE_PALETTE_FIXED.purple,
    PIE_PALETTE_FIXED.slate,
  ];
}

/** 饼图几何常量：viewBox 200×200，圆心 (100,100)，半径 80。 */
const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 80;

/** 角度（弧度，从 12 点方向顺时针）→ 扇区路径端点坐标。 */
function arcPoint(angle: number): {x: number; y: number} {
  return {
    x: CENTER + RADIUS * Math.sin(angle),
    y: CENTER - RADIUS * Math.cos(angle),
  };
}

/** 单个扇区 path：a 从 12 点起顺时针的起止弧度（start < end）。 */
function sectorPath(start: number, end: number): string {
  const from = arcPoint(start);
  const to = arcPoint(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [
    `M ${CENTER} ${CENTER}`,
    `L ${from.x.toFixed(2)} ${from.y.toFixed(2)}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${to.x.toFixed(2)} ${to.y.toFixed(
      2,
    )}`,
    'Z',
  ].join(' ');
}

export function PieChart({
  data,
  totalTokens,
  tokens,
  testID,
}: {
  data: readonly PieChartDatum[];
  /** 占比分母（P1-3）：窗口 summary.totalTokens。 */
  totalTokens: number;
  tokens: ThemeTokens;
  testID?: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const palette = pieChartColors(tokens);

  // 扇区几何：按传入顺序累计角度（从 12 点顺时针），零值行不占角但保留图例。
  const sectors = useMemo(() => {
    const sum = data.reduce((acc, d) => acc + d.totalTokens, 0);
    let cursor = 0;
    return data.map(d => {
      const start = cursor;
      const sweep = sum > 0 ? (d.totalTokens / sum) * Math.PI * 2 : 0;
      cursor += sweep;
      return {datum: d, start, end: cursor, sweep};
    });
  }, [data]);

  const selected = data.find(d => d.key === selectedKey);
  const selectedShare =
    selected != null && totalTokens > 0
      ? selected.totalTokens / totalTokens
      : null;

  if (data.length === 0) {
    return null;
  }

  return (
    <View testID={testID}>
      <View style={styles.pieWrap}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {sectors.map(({datum, start, end, sweep}, index) => {
            const color = palette[index % palette.length];
            const selectedSector = datum.key === selectedKey;
            if (sweep <= 0) {
              return null; // 零值行无扇区（角度退化），图例仍可点选查看
            }
            // 满圆（唯一非零行）用 Circle 表达；扇形 path 在 360° 时起止点
            // 重合会退化成一条线。
            if (sweep >= Math.PI * 2 - 1e-9) {
              return (
                <Circle
                  key={datum.key}
                  testID={`pie-sector-${datum.key}`}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill={color}
                  stroke={selectedSector ? tokens.text : 'none'}
                  strokeWidth={selectedSector ? 3 : 0}
                  onPress={() =>
                    setSelectedKey(selectedSector ? null : datum.key)
                  }
                />
              );
            }
            return (
              <Path
                key={datum.key}
                testID={`pie-sector-${datum.key}`}
                d={sectorPath(start, end)}
                fill={color}
                stroke={selectedSector ? tokens.text : 'none'}
                strokeWidth={selectedSector ? 3 : 0}
                onPress={() =>
                  setSelectedKey(selectedSector ? null : datum.key)
                }
              />
            );
          })}
        </Svg>
      </View>
      {/* 点选详情行：图正下方固定展示（非浮层，规避手势冲突）。 */}
      {selected != null ? (
        <View testID="pie-detail" style={styles.pieDetailRow}>
          <Text style={[styles.pieDetailText, {color: tokens.textSecondary}]}>
            {selected.label} · 用量 {formatTokenCount(selected.totalTokens)} ·
            调用 {selected.calls} 次 · 占比{' '}
            {selectedShare == null
              ? '—'
              : `${Math.round(selectedShare * 100)}%`}
          </Text>
        </View>
      ) : null}
      <View style={styles.pieLegend}>
        {data.map((datum, index) => {
          const color = palette[index % palette.length];
          const selectedLegend = datum.key === selectedKey;
          return (
            <Pressable
              key={datum.key}
              testID={`pie-legend-${datum.key}`}
              onPress={() => setSelectedKey(selectedLegend ? null : datum.key)}
              accessibilityRole="button"
              accessibilityLabel={datum.label}
              style={styles.pieLegendItem}
            >
              <View style={[styles.pieLegendDot, {backgroundColor: color}]} />
              <Text
                style={[
                  styles.pieLegendLabel,
                  {
                    color: selectedLegend ? tokens.primary : tokens.text,
                  },
                ]}
                numberOfLines={1}
              >
                {datum.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
