/**
 * 数据统计页（Mobile）：Token 用量与缓存命中率。
 *
 * - 顶部时间范围 SegmentedControl（近 7 天 / 近 30 天 / 自定义 →
 *   MonthRangePickerSheet，区间 ≤ 366 天校验）+ 用量 / 命中率指标 tab；
 * - 总览卡（跟随筛选）+ 今日卡（独立于筛选，服务层 today 子对象口径）；
 * - 按天 StackedBars 主图，点选某天 → 24 小时分布 + 该天汇总行；
 * - 模型筛选（listModels 只返回非 NULL 模型名，「未记录」由 UI 侧补上）；
 * - 分模型汇总列表（用量降序，null 模型显示「未记录」）；
 * - 命中率 = cacheReadTokens / billedInputTokens，展示层计算；
 *   分母为 0（无 cache 数据）显示「暂无数据」而非 0%。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsSummary,
} from '@novel-master/core/chat';
import { formatTokenCount } from '@novel-master/core/common';
import { AppModal } from '../../components/ui/AppModal';
import { ListSectionTitle } from '../../components/ui/ListSectionTitle';
import { ProfileStatusCard } from '../../components/ui/ProfileStatusCard';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { MonthRangePickerSheet } from '../../components/ui/MonthRangePickerSheet';
import { StackedBars } from '../../components/charts/StackedBars';
import { useToast } from '../../components/chrome/ToastHost';
import { toastMessage } from '../../errors/toast-message';
import { useRuntime } from '../../hooks/useRuntime';
import { useTheme } from '../../theme/ThemeProvider';

type RangeKind = 'last7' | 'last30' | 'custom';
type MetricTab = 'usage' | 'hitRate';

const MS_PER_DAY = 86_400_000;

/** 模型筛选选项的三态哨兵：全部 / 未记录（对应 filter.model 的 undefined / null）。 */
const MODEL_OPTION_ALL = '__all__';
const MODEL_OPTION_UNLOGGED = '__unlogged__';

function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 命中率（0-1），分母无 cache 数据时返回 null（展示「暂无数据」）。 */
function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) {
    return null;
  }
  return cacheRead / billed;
}

/** 自定义区间上限（天，含首尾；避免超长区间查询变慢）。 */
export const CUSTOM_RANGE_MAX_DAYS = 366;

/** 校验自定义区间是否在上限内（from/to 均为本地 0 点的日粒度）。 */
export function isCustomRangeValid(from: Date, to: Date): boolean {
  const dayCount = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
  return dayCount >= 1 && dayCount <= CUSTOM_RANGE_MAX_DAYS;
}

function formatHitRate(rate: number | null): string {
  return rate == null ? '暂无数据' : `${Math.round(rate * 100)}%`;
}

export function TokenUsageStatsScreen() {
  const { tokens } = useTheme();
  const { showToast } = useToast();
  const runtime = useRuntime();

  const [rangeKind, setRangeKind] = useState<RangeKind>('last7');
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const [metricTab, setMetricTab] = useState<MetricTab>('usage');
  const [modelFilter, setModelFilter] = useState<string | null | undefined>(
    undefined,
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [summary, setSummary] = useState<UsageStatsSummary | null>(null);
  const [dailyBuckets, setDailyBuckets] = useState<UsageStatsBucket[]>([]);
  const [modelRows, setModelRows] = useState<UsageStatsModelRow[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hourlyBuckets, setHourlyBuckets] = useState<UsageStatsBucket[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const filter = useMemo<UsageStatsFilter>(() => {
    // 自定义区间：from 为所选日 0 点，to 取结束日次日 0 点（含结束日全天，
    // 与 last7/last30 的「覆盖到本地明日 0 点」口径一致）。
    if (rangeKind === 'custom' && customFrom && customTo) {
      return {
        range: {
          kind: 'custom',
          fromMs: customFrom.getTime(),
          toMs: customTo.getTime() + MS_PER_DAY,
        },
        model: modelFilter,
      };
    }
    return { range: { kind: rangeKind }, model: modelFilter };
  }, [rangeKind, customFrom, customTo, modelFilter]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const usage = runtime.usageStats;
      const [nextSummary, nextBuckets, nextRows] = await Promise.all([
        usage.getSummary(filter),
        usage.getDailyBuckets(filter),
        usage.getModelBreakdown(filter),
      ]);
      setSummary(nextSummary);
      setDailyBuckets(nextBuckets);
      setModelRows(nextRows);
      setSelectedDay(null);
      setHourlyBuckets(null);
    } catch (err) {
      showToast(toastMessage('加载统计失败', err));
    } finally {
      setLoading(false);
    }
  }, [runtime, filter, showToast]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  // 模型选项：listModels 只返回非 NULL 模型名，「未记录」桶由 UI 侧补上
  //（DEV-1，spec T-S5/AC-11）。
  const reloadModels = useCallback(async () => {
    try {
      setModels(await runtime.usageStats.listModels());
    } catch {
      setModels([]);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reloadModels().catch(() => undefined);
    }, [reloadModels]),
  );

  // 选中天后加载 24 小时桶（只应用模型筛选，时间由天本身界定）。
  useEffect(() => {
    if (selectedDay == null) {
      setHourlyBuckets(null);
      return;
    }
    let cancelled = false;
    runtime.usageStats
      .getHourlyBuckets(selectedDay, filter)
      .then(buckets => {
        if (!cancelled) {
          setHourlyBuckets(buckets);
        }
      })
      .catch(err => {
        if (!cancelled) {
          showToast(toastMessage('加载小时分布失败', err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, filter, runtime, showToast]);

  const onRangeKindChange = (value: RangeKind) => {
    if (value === 'custom') {
      // 打开区间选择 sheet；确认成功后才切换到 custom（取消则保持原范围）。
      setRangeSheetVisible(true);
      return;
    }
    setRangeKind(value);
  };

  const onRangeConfirm = (from: Date, to: Date) => {
    if (!isCustomRangeValid(from, to)) {
      showToast('自定义区间最长 366 天');
      return;
    }
    setCustomFrom(from);
    setCustomTo(to);
    setRangeKind('custom');
    setRangeSheetVisible(false);
  };

  const selectedDayBucket =
    selectedDay != null
      ? dailyBuckets.find(b => toLocalDayKey(b.bucketStartMs) === selectedDay)
      : undefined;

  const dailyData = useMemo(() => {
    return dailyBuckets.map(b => {
      const key = toLocalDayKey(b.bucketStartMs);
      if (metricTab === 'hitRate') {
        const rate = hitRate(b.cacheReadTokens, b.billedInputTokens);
        return {
          key,
          primary: rate == null ? 0 : Math.round(rate * 100),
          noData: rate == null,
        };
      }
      return { key, primary: b.promptTokens, secondary: b.completionTokens };
    });
  }, [dailyBuckets, metricTab]);

  const hourlyData = useMemo(() => {
    if (hourlyBuckets == null) {
      return [];
    }
    return hourlyBuckets.map((b, index) => {
      if (metricTab === 'hitRate') {
        const rate = hitRate(b.cacheReadTokens, b.billedInputTokens);
        return {
          key: String(index),
          primary: rate == null ? 0 : Math.round(rate * 100),
          noData: rate == null,
        };
      }
      return {
        key: String(index),
        primary: b.promptTokens,
        secondary: b.completionTokens,
      };
    });
  }, [hourlyBuckets, metricTab]);

  const sortedModelRows = useMemo(
    () => [...modelRows].sort((a, b) => b.totalTokens - a.totalTokens),
    [modelRows],
  );

  const modelFilterLabel =
    modelFilter === undefined
      ? '全部模型'
      : modelFilter === null
      ? '未记录'
      : modelFilter;

  const rangeLabel =
    rangeKind === 'custom' && customFrom && customTo
      ? `${customFrom.getMonth() + 1}/${customFrom.getDate()} — ${
          customTo.getMonth() + 1
        }/${customTo.getDate()}`
      : rangeKind === 'last30'
      ? '近 30 天'
      : '近 7 天';

  const empty =
    summary != null && summary.calls === 0 && summary.totalTokens === 0;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <SegmentedControl
        options={[
          {
            value: 'last7' as RangeKind,
            label: '近 7 天',
            testID: 'range-last7',
          },
          {
            value: 'last30' as RangeKind,
            label: '近 30 天',
            testID: 'range-last30',
          },
          {
            value: 'custom' as RangeKind,
            label: '自定义',
            testID: 'range-custom',
          },
        ]}
        value={rangeKind}
        onChange={onRangeKindChange}
        tokens={tokens}
      />
      <SegmentedControl
        options={[
          {
            value: 'usage' as MetricTab,
            label: '用量',
            testID: 'metric-usage',
          },
          {
            value: 'hitRate' as MetricTab,
            label: '命中率',
            testID: 'metric-hitRate',
          },
        ]}
        value={metricTab}
        onChange={setMetricTab}
        tokens={tokens}
      />
      {loading ? <ActivityIndicator style={styles.loader} /> : null}
      {empty ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>
            当前筛选范围内暂无用量数据。Token
            用量自记录功能上线起开始积累，发起对话后这里会展示统计；缓存命中率数据自本版本起开始记录。
          </Text>
        </View>
      ) : (
        <>
          <ListSectionTitle title={`总览 · ${rangeLabel}`} tokens={tokens} />
          <ProfileStatusCard
            title="用量汇总"
            hint="跟随当前时间范围与模型筛选"
            metrics={[
              {
                label: '总 token',
                value: formatTokenCount(summary?.totalTokens ?? 0),
              },
              {
                label: '输入',
                value: formatTokenCount(summary?.promptTokens ?? 0),
              },
              {
                label: '输出',
                value: formatTokenCount(summary?.completionTokens ?? 0),
              },
              { label: '调用次数', value: String(summary?.calls ?? 0) },
              {
                label: '命中率',
                value: formatHitRate(
                  hitRate(
                    summary?.cacheReadTokens ?? 0,
                    summary?.billedInputTokens ?? 0,
                  ),
                ),
                tone: 'success',
              },
            ]}
            tokens={tokens}
          />
          <ProfileStatusCard
            title="今日"
            hint="不受时间范围与模型筛选影响"
            metrics={[
              {
                label: '总 token',
                value: formatTokenCount(summary?.today.totalTokens ?? 0),
              },
              { label: '调用次数', value: String(summary?.today.calls ?? 0) },
            ]}
            tokens={tokens}
          />
          <ListSectionTitle title="模型筛选" tokens={tokens} />
          <Pressable
            testID="model-filter-entry"
            onPress={() => setModelPickerVisible(true)}
            style={[
              styles.modelFilterRow,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.borderLight,
              },
            ]}
          >
            <Text style={{ color: tokens.text }}>{modelFilterLabel}</Text>
            <Text style={{ color: tokens.textSecondary }}>切换 ›</Text>
          </Pressable>
          <ListSectionTitle
            title={metricTab === 'usage' ? '按天用量' : '按天命中率'}
            tokens={tokens}
          />
          <StackedBars
            testID="daily-chart"
            data={dailyData}
            mode={metricTab}
            selectedKey={selectedDay ?? undefined}
            onSelect={setSelectedDay}
            tokens={tokens}
            formatLabel={key => key.slice(8)}
          />
          {selectedDay != null && selectedDayBucket != null ? (
            <View style={styles.dayDetail}>
              <Text style={[styles.dayDetailTitle, { color: tokens.text }]}>
                {selectedDay} · 按小时分布
              </Text>
              <Text
                style={[
                  styles.dayDetailSummary,
                  { color: tokens.textSecondary },
                ]}
              >
                输入 {formatTokenCount(selectedDayBucket.promptTokens)} · 输出{' '}
                {formatTokenCount(selectedDayBucket.completionTokens)} · 命中率{' '}
                {formatHitRate(
                  hitRate(
                    selectedDayBucket.cacheReadTokens,
                    selectedDayBucket.billedInputTokens,
                  ),
                )}{' '}
                · 调用 {selectedDayBucket.calls} 次
              </Text>
              <StackedBars
                testID="hourly-chart"
                data={hourlyData}
                mode={metricTab}
                tokens={tokens}
                formatLabel={key => `${Number(key)}时`}
              />
            </View>
          ) : null}
          <ListSectionTitle title="分模型汇总" tokens={tokens} />
          {sortedModelRows.map(row => {
            const share =
              summary != null && summary.totalTokens > 0
                ? row.totalTokens / summary.totalTokens
                : null;
            return (
              <View
                key={row.modelName ?? '__unlogged__'}
                style={[
                  styles.modelRow,
                  {
                    backgroundColor: tokens.surface,
                    borderColor: tokens.borderLight,
                  },
                ]}
              >
                <View style={styles.modelRowHead}>
                  <Text style={{ color: tokens.text }} numberOfLines={1}>
                    {row.modelName ?? '未记录'}
                  </Text>
                  <Text style={{ color: tokens.textSecondary }}>
                    占比 {share == null ? '—' : `${Math.round(share * 100)}%`}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.modelRowDetail,
                    { color: tokens.textSecondary },
                  ]}
                >
                  用量 {formatTokenCount(row.totalTokens)} · 调用 {row.calls} 次
                  · 命中率{' '}
                  {formatHitRate(
                    hitRate(row.cacheReadTokens, row.billedInputTokens),
                  )}
                </Text>
              </View>
            );
          })}
        </>
      )}
      <MonthRangePickerSheet
        visible={rangeSheetVisible}
        onClose={() => setRangeSheetVisible(false)}
        onConfirm={onRangeConfirm}
        tokens={tokens}
      />
      <AppModal
        visible={modelPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModelPickerVisible(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setModelPickerVisible(false)}
        >
          <Pressable
            style={[styles.pickerSheet, { backgroundColor: tokens.surface }]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.pickerTitle, { color: tokens.text }]}>
              选择模型
            </Text>
            {[
              { id: MODEL_OPTION_ALL, label: '全部模型' },
              ...models.map(m => ({ id: m, label: m })),
              { id: MODEL_OPTION_UNLOGGED, label: '未记录' },
            ].map(option => {
              const selected =
                option.id === MODEL_OPTION_ALL
                  ? modelFilter === undefined
                  : option.id === MODEL_OPTION_UNLOGGED
                  ? modelFilter === null
                  : modelFilter === option.id;
              return (
                <Pressable
                  key={option.id}
                  testID={`model-option-${option.id}`}
                  onPress={() => {
                    setModelFilter(
                      option.id === MODEL_OPTION_ALL
                        ? undefined
                        : option.id === MODEL_OPTION_UNLOGGED
                        ? null
                        : option.id,
                    );
                    setModelPickerVisible(false);
                  }}
                  style={[
                    styles.pickerRow,
                    { borderBottomColor: tokens.border },
                    selected && { backgroundColor: tokens.bgSecondary },
                  ]}
                >
                  <Text style={{ color: tokens.text }} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {selected ? (
                    <Text style={{ color: tokens.primary }}>当前</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  loader: { marginVertical: 12 },
  empty: { padding: 32, gap: 16, alignItems: 'center' },
  emptyText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  modelFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dayDetail: { marginTop: 12, gap: 8 },
  dayDetailTitle: { fontSize: 15, fontWeight: '600' },
  dayDetailSummary: { fontSize: 13 },
  modelRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginBottom: 8,
  },
  modelRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  modelRowDetail: { fontSize: 13 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
