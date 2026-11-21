/**
 * 指标条用量详情底部 sheet（metric-detail-sheet Step 4，T-MD5）。
 *
 * 打开时经 runtime.usageStats.getSessionUsageDetail(sessionId) 自取会话
 * 维度详情（弹窗状态自持于 Live 层独立 state，不进 250ms tick 的 metrics
 * 快照）；「上下文占用」行不做新取数——直接渲染调用方传入的
 * contextTokenLabel（主屏 agentMeta.tokenLabel 现有字符串，与 chip 同源）。
 * 命中率复用数据统计页 format.ts 的 hitRate/formatHitRate（公式单源）。
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {SessionUsageDetail} from '@novel-master/core/chat';
import {TokenFormat} from '@novel-master/core/common';
import {ModalShell} from '../ui/ModalShell';
import {coreT} from '@/i18n/core';
import {UsageStats} from '@/screens/stack/token-usage/format';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  visible: boolean;
  /** 指标归属会话：数据按会话自身统计（子会话屏传子会话 id）。 */
  sessionId: string;
  /** 与 chip 同源的上下文占用现成字符串（agentMeta.tokenLabel）；缺省出「—」。 */
  contextTokenLabel?: string;
  onClose: () => void;
};

export function MetricDetailSheet({visible, sessionId, contextTokenLabel, onClose}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [detail, setDetail] = useState<SessionUsageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // visible 翻真时自取一次（弹窗打开的非热路径）；切会话/重开重新拉。
  // 依赖只挂 [visible, sessionId]：usageStats 经 runtime 在 effect 内取，
  // 不把 runtime.usageStats 引用放进依赖——runtime 对象引用是否稳定是
  // 装配层的事（组件对引用形状不敏感，避免依赖变化引发重复取数循环）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const detailPromise = runtime.usageStats.getSessionUsageDetail(sessionId);
    detailPromise
      .then(result => {
        if (!cancelled) {
          // 已知失败走 Result 收口（错误通道迁移四期）；未知异常仍走异常通道。
          setError(result.ok ? null : result.error instanceof Error ? result.error.message : String(result.error));
          setDetail(result.ok ? result.value : null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, sessionId]);

  const last = detail?.last ?? null;
  let lastBilledInput = 0;
  if (last != null) {
    // 单行计费口径（与 core BILLED_INPUT_SUM_SQL 的单行版一致）。
    const hasCacheColumns = last.cacheReadTokens != null || last.cacheCreationTokens != null;
    // anthropic 的 input_tokens 不含 cache，须加回 cache 双列；其余协议
    // prompt 已含 cached（与统计页口径一致，公式单源随 tl 后续抽 core）。
    lastBilledInput = hasCacheColumns && last.provider === 'anthropic' ? last.promptTokens + (last.cacheReadTokens ?? 0) + (last.cacheCreationTokens ?? 0) : last.promptTokens;
  }

  return (
    <ModalShell visible={visible} onClose={onClose} variant="bottom" backdropOpacity={0.55} keyboardAvoid={{kind: 'none'}} panelStyle={styles.sheet}>
      <Text style={[styles.heading, {color: tokens.text}]}>{coreT({key: "ui.stats.detail_title"})}</Text>
      {loading ? (
        <Text testID="metric-detail-sheet-loading" style={[styles.hint, {color: tokens.textSecondary}]}>
          {coreT({key: "ui.common.loading"})}
        </Text>
      ) : error != null ? (
        <Text testID="metric-detail-sheet-error" style={[styles.hint, {color: tokens.danger}]}>
          {error}
        </Text>
      ) : (
        <ScrollView testID="metric-detail-sheet-content" style={styles.body} showsVerticalScrollIndicator={false}>
          <SectionLabel text={coreT({key: "ui.stats.recent_requests"})} tokens={tokens} />
          {last == null ? (
            <EmptyRow text={coreT({key: "ui.stats.recent_empty"})} tokens={tokens} />
          ) : (
            <>
              <Row label={coreT({key: "ui.common.model"})} value={last.modelName ?? '—'} tokens={tokens} />
              <Row label={coreT({key: "ui.stats.input_label"})} value={TokenFormat.count(last.promptTokens)} tokens={tokens} />
              <Row label={coreT({key: "ui.stats.output_label"})} value={TokenFormat.count(last.completionTokens)} tokens={tokens} />
              <Row label={coreT({key: "ui.stats.cache_read"})} value={last.cacheReadTokens == null ? '—' : TokenFormat.count(last.cacheReadTokens)} tokens={tokens} />
              <Row label={coreT({key: "ui.stats.cache_write"})} value={last.cacheCreationTokens == null ? '—' : TokenFormat.count(last.cacheCreationTokens)} tokens={tokens} />
              <Row label={coreT({key: "ui.stats.cache_hit_rate"})} value={last.cacheReadTokens == null ? '—' : UsageStats.formatHitRate(UsageStats.hitRate(last.cacheReadTokens, lastBilledInput))} tokens={tokens} />
            </>
          )}
          <SectionLabel text={coreT({key: "ui.stats.session_total"})} tokens={tokens} />
          <Row label={coreT({key: "ui.stats.visible_messages"})} value={String(detail?.visibleMessageCount ?? 0)} tokens={tokens} />
          <Row label={coreT({key: "ui.stats.tool_calls"})} value={String(detail?.toolUseCount ?? 0)} tokens={tokens} />
          <Row label={coreT({key: "ui.session.context_usage"})} value={contextTokenLabel ?? '—'} tokens={tokens} />
          {/* 口径脚注第二行（cr-md-1）：「最近请求」是单步真值，与指标条
              整轮读数不同源——文案与 desktop 侧同文，勿单侧改写。 */}
          <Text testID="metric-detail-sheet-footnote" style={[styles.footnote, {color: tokens.textTertiary}]}>
            {coreT({key: "ui.stats.footnote_visible"})}
          </Text>
          <Text style={[styles.footnoteLine2, {color: tokens.textTertiary}]}>{coreT({key: "ui.stats.footnote_recent"})}</Text>
        </ScrollView>
      )}
    </ModalShell>
  );
}

type ThemeTokensShape = {
  text: string;
  textSecondary: string;
};

function SectionLabel({text, tokens}: {text: string; tokens: ThemeTokensShape}) {
  return (
    <Text
      style={{
        color: tokens.textSecondary,
        fontSize: 12,
        fontWeight: '600',
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {text}
    </Text>
  );
}

function Row({label, value, tokens}: {label: string; value: string; tokens: ThemeTokensShape}) {
  return (
    <View style={styles.row}>
      <Text style={{color: tokens.textSecondary, fontSize: 13}}>{label}</Text>
      <Text style={{color: tokens.text, fontSize: 13, fontWeight: '500'}}>{value}</Text>
    </View>
  );
}

function EmptyRow({text, tokens}: {text: string; tokens: ThemeTokensShape}) {
  return <Text style={{color: tokens.textSecondary, fontSize: 13, paddingVertical: 6}}>{text}</Text>;
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    maxHeight: '70%',
  },
  heading: {fontSize: 18, fontWeight: '600'},
  hint: {fontSize: 13, paddingVertical: 12},
  body: {marginTop: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 5,
  },
  footnote: {
    fontSize: 11,
    marginTop: 12,
  },
  footnoteLine2: {
    fontSize: 11,
    marginTop: 2,
  },
});
