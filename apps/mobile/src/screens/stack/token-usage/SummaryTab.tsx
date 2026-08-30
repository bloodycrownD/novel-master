import React, {useMemo} from 'react';
import {Text, View} from 'react-native';
import type {
  UsageStatsModelRow,
  UsageStatsSummary,
} from '@novel-master/core/chat';
import {formatTokenCount} from '@novel-master/core/common';
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

/** 汇总页签指标小卡；宽卡（wide）独占一行（今日卡），三列卡（third）一行放三个（命中率/速率/首字延迟）。 */
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
 * 今日卡：独立于筛选（服务层 today 子对象口径），范围空态下也保留渲染
 *（mobile/A-1）。供汇总页签与主屏空态共用。
 */
export function TodayCard({
  summary,
  tokens,
}: {
  summary: UsageStatsSummary | null;
  tokens: ThemeTokens;
}) {
  return (
    <View
      testID="today-card"
      style={[
        styles.tile,
        styles.tileWide,
        styles.todayCard,
        {backgroundColor: tokens.surface},
      ]}
    >
      <Text style={[styles.tileLabel, {color: tokens.textSecondary}]}>
        今日 · 不受时间范围与模型筛选影响
      </Text>
      <View style={styles.todayRow}>
        <View style={styles.todayMetric}>
          <Text style={[styles.tileLabel, {color: tokens.textSecondary}]}>
            总 token
          </Text>
          <Text
            style={[styles.tileValue, {color: tokens.text}]}
            numberOfLines={1}
          >
            {formatTokenCount(summary?.today.totalTokens ?? 0)}
          </Text>
        </View>
        <View style={styles.todayMetric}>
          <Text style={[styles.tileLabel, {color: tokens.textSecondary}]}>
            调用次数
          </Text>
          <Text
            style={[styles.tileValue, {color: tokens.text}]}
            numberOfLines={1}
          >
            {String(summary?.today.calls ?? 0)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * 汇总页签（screens/C-4 拆分自主文件）：范围内五指标卡（2 列网格 +
 * 三列一行）+ 今日宽卡 + 分模型列表（模型名 / 用量 / 占比 / 调用次数，
 * 按用量降序，不含命中率列）。
 */
export function SummaryTab({
  summary,
  modelRows,
  rangeLabel,
  tokens,
}: {
  summary: UsageStatsSummary | null;
  modelRows: UsageStatsModelRow[];
  rangeLabel: string;
  tokens: ThemeTokens;
}) {
  // 聚合数据归汇总页签：分模型列表跟随五指标卡与今日卡展示。
  const sortedModelRows = useMemo(
    () => [...modelRows].sort((a, b) => b.totalTokens - a.totalTokens),
    [modelRows],
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
      <TodayCard summary={summary} tokens={tokens} />
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
              <Text style={{color: tokens.text}} numberOfLines={1}>
                {row.modelName ?? '其他'}
              </Text>
              <Text style={{color: tokens.textSecondary}}>
                占比 {share == null ? '—' : `${Math.round(share * 100)}%`}
              </Text>
            </View>
            <Text
              style={[styles.modelRowDetail, {color: tokens.textSecondary}]}
            >
              用量 {formatTokenCount(row.totalTokens)} · 调用 {row.calls} 次
            </Text>
          </View>
        );
      })}
    </>
  );
}
