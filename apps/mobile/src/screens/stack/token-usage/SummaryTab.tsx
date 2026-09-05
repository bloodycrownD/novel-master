import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {
  UsageStatsModelRow,
  UsageStatsSummary,
} from '@novel-master/core/chat';
import {formatTokenCount} from '@novel-master/core/common';
import {PieChart} from '../../../components/charts/PieChart';
import {ListSectionTitle} from '../../../components/ui/ListSectionTitle';
import type {ThemeTokens} from '../../../theme/tokens';
import {
  SUMMARY_EMPTY_TEXT,
  formatFirstTokenMs,
  formatHitRate,
  formatTokensPerSecond,
  hitRate,
} from './format';
import {styles} from './styles';

/** 汇总页签指标小卡；宽卡（wide）独占一行，三列卡（third）一行放三个（命中率/速率/首字延迟）。 */
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
  layout?: 'half' | 'wide' | 'third';
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        layout === 'wide' && styles.tileWide,
        layout === 'third' && styles.tileThird,
        {backgroundColor: tokens.surface},
      ]}
    >
      <Text style={[styles.tileLabel, {color: tokens.textSecondary}]}>
        {label}
      </Text>
      <Text
        style={[
          styles.tileValue,
          {color: tone === 'success' ? tokens.success : tokens.text},
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * 汇总页签（screens/C-4 拆分自主文件）：范围内五指标卡（2 列网格 +
 * 三列一行）+ 服务商×模型饼图（数据行原样不折叠，点选出固定详情行）。
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
          key: `${row.providerId ?? '__np__'}::${
            row.modelName ?? '__unlogged__'
          }`,
          // label 三态：未记录服务商兜 provider_id IS NULL 的合并行（core
          // 已归并为单行，不拼模型后缀）；名称解析不到兑底「未知服务
          // 商」；modelName 为 null 归「{服务商} · 其他模型」。
          label:
            row.providerId == null
              ? '未记录服务商'
              : row.modelName == null
              ? `${providerLabels[row.providerId] ?? '未知服务商'} · 其他模型`
              : `${providerLabels[row.providerId] ?? '未知服务商'} · ${
                  row.modelName
                }`,
          totalTokens: row.totalTokens,
          calls: row.calls,
        })),
    [modelRows, providerLabels],
  );

  return (
    <>
      <ListSectionTitle title={`总览 · ${rangeLabel}`} tokens={tokens} />
      <View style={styles.summaryGrid}>
        <SummaryTile
          testID="summary-metric-total"
          label="总 token"
          value={formatTokenCount(summary?.totalTokens ?? 0)}
          tokens={tokens}
        />
        <SummaryTile
          testID="summary-metric-input"
          label="输入"
          value={formatTokenCount(summary?.promptTokens ?? 0)}
          tokens={tokens}
        />
        <SummaryTile
          testID="summary-metric-output"
          label="输出"
          value={formatTokenCount(summary?.completionTokens ?? 0)}
          tokens={tokens}
        />
        <SummaryTile
          testID="summary-metric-calls"
          label="调用次数"
          value={String(summary?.calls ?? 0)}
          tokens={tokens}
        />
      </View>
      {/* 命中率/速率/首字延迟三卡一行（31% 列）；marginTop 补与上半卡行的垂直间距 */}
      <View style={[styles.summaryGrid, styles.tileThirdRow]}>
        <SummaryTile
          testID="summary-metric-hitRate"
          label="命中率"
          value={formatHitRate(
            hitRate(
              summary?.cacheReadTokens ?? 0,
              summary?.billedInputTokens ?? 0,
            ),
          )}
          tone="success"
          layout="third"
          tokens={tokens}
        />
        {/* 新指标卡：无有效行为 null → 空态横杠而非 0 */}
        <SummaryTile
          testID="summary-metric-avgTokensPerSecond"
          label="平均速率"
          value={formatTokensPerSecond(
            summary?.avgTokensPerSecond ?? null,
            SUMMARY_EMPTY_TEXT,
          )}
          layout="third"
          tokens={tokens}
        />
        <SummaryTile
          testID="summary-metric-avgFirstTokenMs"
          label="平均首字延迟"
          value={formatFirstTokenMs(
            summary?.avgFirstTokenMs ?? null,
            SUMMARY_EMPTY_TEXT,
          )}
          layout="third"
          tokens={tokens}
        />
      </View>
      <ListSectionTitle title="分服务商×模型汇总" tokens={tokens} />
      <PieChart
        testID="provider-model-pie"
        data={pieData}
        totalTokens={summary?.totalTokens ?? 0}
        tokens={tokens}
      />
    </>
  );
}
