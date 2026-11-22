import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {UsageStatsModelRow, UsageStatsSummary} from '@novel-master/core/chat';
import {TokenFormat} from '@novel-master/core/common';
import {PieChart} from '../../../components/charts/PieChart';
import {ListSectionTitle} from '../../../components/ui/ListSectionTitle';
import type {ThemeTokens} from '../../../theme/tokens';
import {coreT} from '@/i18n/core';
import {SUMMARY_EMPTY_TEXT, UsageStats} from './format';
import {styles} from './styles';

/** 汇总页签指标小卡：half 两列一行（默认），third 三列一行（输入/输出/命中率）。 */
function SummaryTile({
    label,
    value,
    tokens,
    tone = 'default',
    layout = 'half',
    testID,
}: {
    label: string;
    value: string;
    tokens: ThemeTokens;
    tone?: 'default' | 'success';
    layout?: 'half' | 'third';
    testID?: string;
}) {
    return (
        <View testID={testID} style={[styles.tile, layout === 'third' && styles.tileThird, {backgroundColor: tokens.surface}]}>
            <Text style={[styles.tileLabel, {color: tokens.textSecondary}]}>{label}</Text>
            <Text style={[styles.tileValue, {color: tone === 'success' ? tokens.success : tokens.text}]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

/**
 * 汇总页签（screens/C-4 拆分自主文件）：范围内七指标卡三行——总 token/调用
 * 次数 → 平均速率/平均首字延迟 → 输入/输出/命中率（用户拍板 2026-09-28
 * 重排：速率两卡上移、输入/输出/命中率下移为三列行）+ 服务商×模型饼图
 * （数据行原样不折叠，点选出固定详情行）。
 */
export function SummaryTab({
    summary,
    modelRows,
    providerLabels,
    rangeLabel,
    tokens,
}: {
    summary: UsageStatsSummary | null;
    modelRows: UsageStatsModelRow[];
    /** providerId → 展示名；服务商已删除时缺失，展示「未知服务商」。 */
    providerLabels: Record<string, string>;
    rangeLabel: string;
    tokens: ThemeTokens;
}) {
    // 聚合数据归汇总页签：饼图跟随五指标卡展示，数据行原样不折叠、按用量降序。
    const pieData = useMemo(
        () =>
            [...modelRows]
                .sort((a, b) => b.totalTokens - a.totalTokens)
                .map(row => ({
                    key: `${row.providerId ?? '__np__'}::${row.modelName ?? '__unlogged__'}`,
                    // label 三态：未记录服务商兜 provider_id IS NULL 的合并行（core
                    // 已归并为单行，不拼模型后缀）；名称解析不到兑底「未知服务
                    // 商」；modelName 为 null 归「{服务商}/其他模型」（斜杠格式与
                    // 聊天侧模型选择下拉一致，2026-09-28 统一）。
                    label:
                        row.providerId == null
                            ? coreT({key: "ui.stats.provider_unlogged"})
                            : row.modelName == null
                            ? coreT({key: "ui.stats.provider_other_label", params: {provider: providerLabels[row.providerId] ?? coreT({key: "ui.provider.unknown_provider"})}})
                            : `${providerLabels[row.providerId] ?? coreT({key: "ui.provider.unknown_provider"})}/${row.modelName}`,
                    totalTokens: row.totalTokens,
                    calls: row.calls,
                })),
        [modelRows, providerLabels],
    );

    return (
        <>
            <ListSectionTitle title={coreT({key: "ui.stats.overview_title", params: {range: rangeLabel}})} tokens={tokens} />
            <View style={styles.summaryGrid}>
                <SummaryTile testID="summary-metric-total" label={coreT({key: "ui.stats.total_tokens"})} value={TokenFormat.count(summary?.totalTokens ?? 0)} tokens={tokens} />
                <SummaryTile testID="summary-metric-calls" label={coreT({key: "ui.stats.calls_label"})} value={String(summary?.calls ?? 0)} tokens={tokens} />
                {/* 平均速率/首字延迟上移为第二行两卡（用户拍板 2026-09-28 重排）；
            无有效行为 null → 空态横杠而非 0 */}
                <SummaryTile testID="summary-metric-avgTokensPerSecond" label={coreT({key: "ui.stats.avg_rate"})} value={UsageStats.formatTokensPerSecond(summary?.avgTokensPerSecond ?? null, SUMMARY_EMPTY_TEXT)} tokens={tokens} />
                <SummaryTile testID="summary-metric-avgFirstTokenMs" label={coreT({key: "ui.stats.avg_first_token"})} value={UsageStats.formatFirstTokenMs(summary?.avgFirstTokenMs ?? null, SUMMARY_EMPTY_TEXT)} tokens={tokens} />
            </View>
            {/* 输入/输出/命中率下移为第三行三卡一行（31% 列）；marginTop 补与
          上半卡行的垂直间距 */}
            <View style={[styles.summaryGrid, styles.tileThirdRow]}>
                <SummaryTile testID="summary-metric-input" label={coreT({key: "ui.stats.input_label"})} value={TokenFormat.count(summary?.promptTokens ?? 0)} layout="third" tokens={tokens} />
                <SummaryTile testID="summary-metric-output" label={coreT({key: "ui.stats.output_label"})} value={TokenFormat.count(summary?.completionTokens ?? 0)} layout="third" tokens={tokens} />
                <SummaryTile
                    testID="summary-metric-hitRate"
                    label={coreT({key: "ui.stats.hit_rate"})}
                    value={UsageStats.formatHitRate(UsageStats.hitRate(summary?.cacheReadTokens ?? 0, summary?.billedInputTokens ?? 0))}
                    tone="success"
                    layout="third"
                    tokens={tokens}
                />
            </View>
            <ListSectionTitle title={coreT({key: "ui.stats.pie_section"})} tokens={tokens} />
            <PieChart testID="provider-model-pie" data={pieData} totalTokens={summary?.totalTokens ?? 0} tokens={tokens} />
        </>
    );
}
