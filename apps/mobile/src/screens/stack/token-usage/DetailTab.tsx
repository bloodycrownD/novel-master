import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {UsageStatsBucket} from '@novel-master/core/chat';
import {formatTokenCount} from '@novel-master/core/common';
import {StackedBars} from '../../../components/charts/StackedBars';
import {ListSectionTitle} from '../../../components/ui/ListSectionTitle';
import type {ThemeTokens} from '../../../theme/tokens';
import {
  formatFirstTokenMs,
  formatHitRate,
  formatTokensPerSecond,
  hitRate,
  toLocalDayKey,
} from './format';
import {styles} from './styles';

/**
 * 明细页签（screens/C-4 拆分自主文件）：按天用量 StackedBars（纯用量
 * 堆叠，无命中率图表模式），点选某天 → 24 小时分布 + 该天汇总行（汇总
 * 行保留命中率）；长按检视的详情以图下方固定行呈现而非浮层，规避长按
 * 与横向滚动的手势冲突。
 */
export function DetailTab({
  dailyBuckets,
  hourlyBuckets,
  selectedDay,
  inspectedKey,
  onSelectDay,
  onSetInspectedKey,
  tokens,
}: {
  dailyBuckets: UsageStatsBucket[];
  hourlyBuckets: UsageStatsBucket[] | null;
  selectedDay: string | null;
  /** 长按检视的柱 key（daily 为日期、hourly 为序号，两图 key 域不同）。 */
  inspectedKey: string | null;
  onSelectDay: (day: string | null) => void;
  onSetInspectedKey: (key: string | null) => void;
  tokens: ThemeTokens;
}) {
  const dailyData = useMemo(() => {
    return dailyBuckets.map(b => ({
      key: toLocalDayKey(b.bucketStartMs),
      primary: b.promptTokens,
      secondary: b.completionTokens,
      calls: b.calls,
    }));
  }, [dailyBuckets]);

  const hourlyData = useMemo(() => {
    if (hourlyBuckets == null) {
      return [];
    }
    return hourlyBuckets.map((b, index) => ({
      key: String(index),
      primary: b.promptTokens,
      secondary: b.completionTokens,
      calls: b.calls,
    }));
  }, [hourlyBuckets]);

  const selectedDayBucket =
    selectedDay != null
      ? dailyBuckets.find(b => toLocalDayKey(b.bucketStartMs) === selectedDay)
      : undefined;

  // 长按检视的柱：分别往两图数据里找（key 域不同：daily 为日期、hourly 为序号）
  const dailyInspected =
    inspectedKey != null
      ? dailyData.find(d => d.key === inspectedKey)
      : undefined;
  const hourlyInspected =
    inspectedKey != null
      ? hourlyData.find(d => d.key === inspectedKey)
      : undefined;

  return (
    <>
      <ListSectionTitle title="按天用量" tokens={tokens} />
      <View style={[styles.chartCard, {backgroundColor: tokens.surface}]}>
        <StackedBars
          testID="daily-chart"
          data={dailyData}
          selectedKey={selectedDay ?? undefined}
          onSelect={onSelectDay}
          onLongPress={onSetInspectedKey}
          tokens={tokens}
          formatLabel={key => key.slice(8)}
        />
      </View>
      {dailyInspected != null ? (
        <View testID="bar-inspect" style={styles.inspectRow}>
          <Text style={[styles.inspectText, {color: tokens.textSecondary}]}>
            {dailyInspected.key.slice(8)} 日 · 输入{' '}
            {formatTokenCount(dailyInspected.primary)} · 输出{' '}
            {formatTokenCount(dailyInspected.secondary ?? 0)} · 调用{' '}
            {dailyInspected.calls ?? 0} 次
          </Text>
        </View>
      ) : null}
      {selectedDay != null && selectedDayBucket != null ? (
        <View style={styles.dayDetail}>
          <Text style={[styles.dayDetailTitle, {color: tokens.text}]}>
            {selectedDay} · 按小时分布
          </Text>
          <Text
            style={[styles.dayDetailSummary, {color: tokens.textSecondary}]}
          >
            输入 {formatTokenCount(selectedDayBucket.promptTokens)} · 输出{' '}
            {formatTokenCount(selectedDayBucket.completionTokens)} · 命中率{' '}
            {formatHitRate(
              hitRate(
                selectedDayBucket.cacheReadTokens,
                selectedDayBucket.billedInputTokens,
              ),
            )}{' '}
            · 调用 {selectedDayBucket.calls} 次 · 平均速率{' '}
            {formatTokensPerSecond(selectedDayBucket.avgTokensPerSecond, '—')} ·
            平均首字延迟{' '}
            {formatFirstTokenMs(selectedDayBucket.avgFirstTokenMs, '—')}
          </Text>
          <View style={[styles.chartCard, {backgroundColor: tokens.surface}]}>
            <StackedBars
              testID="hourly-chart"
              data={hourlyData}
              onLongPress={onSetInspectedKey}
              tokens={tokens}
              formatLabel={key => `${Number(key)}时`}
            />
          </View>
          {hourlyInspected != null ? (
            <View testID="bar-inspect" style={styles.inspectRow}>
              <Text style={[styles.inspectText, {color: tokens.textSecondary}]}>
                {Number(hourlyInspected.key)}时 · 输入{' '}
                {formatTokenCount(hourlyInspected.primary)} · 输出{' '}
                {formatTokenCount(hourlyInspected.secondary ?? 0)} · 调用{' '}
                {hourlyInspected.calls ?? 0} 次
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
