import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {UsageStatsBucket} from '@novel-master/core/chat';
import {DateTime, TokenFormat} from '@novel-master/core/common';
import {StackedBars} from '../../../components/charts/StackedBars';
import {ListSectionTitle} from '../../../components/ui/ListSectionTitle';
import type {ThemeTokens} from '../../../theme/tokens';
import {coreT} from '@/i18n/core';
import {UsageStats} from './format';
import {styles} from './styles';

/**
 * 图表页签（screens/C-4 拆分自主文件）：按天用量 StackedBars（纯用量
 * 堆叠，无命中率图表模式），点选某天 → 24 小时分布 + 该天汇总行（汇总
 * 行保留命中率）；长按检视的详情以图下方固定行呈现而非浮层，规避长按
 * 与横向滚动的手势冲突。
 *
 * today 模式（时间筛选 = 今天）：隐藏按天图区块，直出当天汇总行 +
 * 24 小时图——主屏在 reload 成功回调里已补选 selectedDay=今天（P1-1），
 * 本组件只按标志跳过 daily 图，汇总行/小时图逻辑与非 today 模式复用。
 */
export function DetailTab({
    dailyBuckets,
    hourlyBuckets,
    selectedDay,
    inspectedKey,
    onSelectDay,
    onSetInspectedKey,
    tokens,
    todayMode = false,
}: {
    dailyBuckets: UsageStatsBucket[];
    hourlyBuckets: UsageStatsBucket[] | null;
    selectedDay: string | null;
    /** 长按检视的柱 key（daily 为日期、hourly 为序号，两图 key 域不同）。 */
    inspectedKey: string | null;
    onSelectDay: (day: string | null) => void;
    onSetInspectedKey: (key: string | null) => void;
    tokens: ThemeTokens;
    /** 今天模式：隐藏按天图，直出当天汇总行 + 24 小时图（唯一日桶）。 */
    todayMode?: boolean;
}) {
    const dailyData = useMemo(() => {
        return dailyBuckets.map(b => ({
            key: DateTime.localDayKey(b.bucketStartMs),
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

    const selectedDayBucket = selectedDay != null ? dailyBuckets.find(b => DateTime.localDayKey(b.bucketStartMs) === selectedDay) : undefined;

    // 长按检视的柱：分别往两图数据里找（key 域不同：daily 为日期、hourly 为序号）
    const dailyInspected = inspectedKey != null ? dailyData.find(d => d.key === inspectedKey) : undefined;
    const hourlyInspected = inspectedKey != null ? hourlyData.find(d => d.key === inspectedKey) : undefined;

    return (
        <>
            {/* today 模式不渲染按天图区块：选中天恒为今天（主屏补选），
          daily 检视与点选自然不可达。 */}
            {todayMode ? null : (
                <>
                    <ListSectionTitle title={coreT({key: "ui.stats.by_day_title"})} tokens={tokens} />
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
                                {coreT({key: "ui.stats.bucket_line", params: {key: dailyInspected.key.slice(8), input: TokenFormat.count(dailyInspected.primary), output: TokenFormat.count(dailyInspected.secondary ?? 0), calls: String(dailyInspected.calls ?? 0)}})}
                            </Text>
                        </View>
                    ) : null}
                </>
            )}
            {selectedDay != null && selectedDayBucket != null ? (
                <View style={styles.dayDetail}>
                    <Text style={[styles.dayDetailTitle, {color: tokens.text}]}>{coreT({key: "ui.stats.day_hourly_template", params: {day: selectedDay}})}</Text>
                    <Text style={[styles.dayDetailSummary, {color: tokens.textSecondary}]}>
                        {coreT({key: "ui.stats.input_label"})} {TokenFormat.count(selectedDayBucket.promptTokens)} · {coreT({key: "ui.stats.output_label"})} {TokenFormat.count(selectedDayBucket.completionTokens)} · {coreT({key: "ui.stats.hit_rate"})}{' '}
                        {UsageStats.formatHitRate(UsageStats.hitRate(selectedDayBucket.cacheReadTokens, selectedDayBucket.billedInputTokens))} · {coreT({key: "ui.stats.chart_calls_aria", params: {count: String(selectedDayBucket.calls)}})} · {coreT({key: "ui.stats.avg_rate"})}{' '}
                        {UsageStats.formatTokensPerSecond(selectedDayBucket.avgTokensPerSecond, '—')} · {coreT({key: "ui.stats.avg_first_token"})} {UsageStats.formatFirstTokenMs(selectedDayBucket.avgFirstTokenMs, '—')}
                    </Text>
                    <View style={[styles.chartCard, {backgroundColor: tokens.surface}]}>
                        <StackedBars testID="hourly-chart" data={hourlyData} onLongPress={onSetInspectedKey} tokens={tokens} formatLabel={key => coreT({key: "ui.stats.hour_label", params: {hour: String(Number(key))}})} />
                    </View>
                    {hourlyInspected != null ? (
                        <View testID="bar-inspect" style={styles.inspectRow}>
                            <Text style={[styles.inspectText, {color: tokens.textSecondary}]}>
                                {coreT({key: "ui.stats.bucket_line", params: {key: String(Number(hourlyInspected.key)), input: TokenFormat.count(hourlyInspected.primary), output: TokenFormat.count(hourlyInspected.secondary ?? 0), calls: String(hourlyInspected.calls ?? 0)}})}
                            </Text>
                        </View>
                    ) : null}
                </View>
            ) : null}
        </>
    );
}
