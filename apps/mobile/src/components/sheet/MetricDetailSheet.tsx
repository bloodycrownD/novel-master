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
import {formatTokenCount} from '@novel-master/core/common';
import {ModalShell} from '../ui/ModalShell';
import {hitRate, formatHitRate} from '@/screens/stack/token-usage/format';
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

/** 单行计费口径输入（与 core BILLED_INPUT_SUM_SQL 的单行版一致）。 */
function lastRowBilledInput(last: NonNullable<SessionUsageDetail['last']>): number {
  const hasCacheColumns =
    last.cacheReadTokens != null || last.cacheCreationTokens != null;
  if (!hasCacheColumns) {
    return last.promptTokens;
  }
  // anthropic 的 input_tokens 不含 cache，须加回 cache 双列；其余协议
  // prompt 已含 cached（与统计页口径一致，公式单源随 tl 后续抽 core）。
  return last.provider === 'anthropic'
    ? last.promptTokens +
        (last.cacheReadTokens ?? 0) +
        (last.cacheCreationTokens ?? 0)
    : last.promptTokens;
}

export function MetricDetailSheet({
  visible,
  sessionId,
  contextTokenLabel,
  onClose,
}: Props) {
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
    runtime.usageStats
      .getSessionUsageDetail(sessionId)
      .then(result => {
        if (!cancelled) {
          setDetail(result);
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
  const totals = detail?.totals ?? null;

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant="bottom"
      backdropOpacity={0.55}
      keyboardAvoid={{kind: 'none'}}
      panelStyle={styles.sheet}
    >
      <Text style={[styles.heading, {color: tokens.text}]}>用量详情</Text>
      {loading ? (
        <Text
          testID="metric-detail-sheet-loading"
          style={[styles.hint, {color: tokens.textSecondary}]}
        >
          加载中…
        </Text>
      ) : error != null ? (
        <Text
          testID="metric-detail-sheet-error"
          style={[styles.hint, {color: tokens.danger}]}
        >
          {error}
        </Text>
      ) : (
        <ScrollView
          testID="metric-detail-sheet-content"
          style={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel text="最近请求" tokens={tokens} />
          {last == null ? (
            <EmptyRow text="暂无请求记录" tokens={tokens} />
          ) : (
            <>
              <Row label="模型" value={last.modelName ?? '—'} tokens={tokens} />
              <Row
                label="输入"
                value={formatTokenCount(last.promptTokens)}
                tokens={tokens}
              />
              <Row
                label="输出"
                value={formatTokenCount(last.completionTokens)}
                tokens={tokens}
              />
              <Row
                label="缓存读取"
                value={
                  last.cacheReadTokens == null
                    ? '—'
                    : formatTokenCount(last.cacheReadTokens)
                }
                tokens={tokens}
              />
              <Row
                label="缓存写入"
                value={
                  last.cacheCreationTokens == null
                    ? '—'
                    : formatTokenCount(last.cacheCreationTokens)
                }
                tokens={tokens}
              />
              <Row
                label="缓存命中率"
                value={
                  last.cacheReadTokens == null
                    ? '—'
                    : formatHitRate(
                        hitRate(last.cacheReadTokens, lastRowBilledInput(last)),
                      )
                }
                tokens={tokens}
              />
            </>
          )}
          <SectionLabel text="会话累计" tokens={tokens} />
          {totals == null ? (
            <EmptyRow text="暂无累计数据" tokens={tokens} />
          ) : (
            <>
              <Row
                label="消息数（可见）"
                value={String(detail?.visibleMessageCount ?? 0)}
                tokens={tokens}
              />
              <Row
                label="工具调用"
                value={String(detail?.toolUseCount ?? 0)}
                tokens={tokens}
              />
              <Row
                label="累计输入"
                value={formatTokenCount(totals.promptTokens)}
                tokens={tokens}
              />
              <Row
                label="累计输出"
                value={formatTokenCount(totals.completionTokens)}
                tokens={tokens}
              />
            </>
          )}
          <Row
            label="上下文占用"
            value={contextTokenLabel ?? '—'}
            tokens={tokens}
          />
          <Text
            testID="metric-detail-sheet-footnote"
            style={[styles.footnote, {color: tokens.textTertiary}]}
          >
            累计含隐藏消息 · 消息数为可见口径
          </Text>
        </ScrollView>
      )}
    </ModalShell>
  );
}

type ThemeTokensShape = {
  text: string;
  textSecondary: string;
};

function SectionLabel({
  text,
  tokens,
}: {
  text: string;
  tokens: ThemeTokensShape;
}) {
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

function Row({
  label,
  value,
  tokens,
}: {
  label: string;
  value: string;
  tokens: ThemeTokensShape;
}) {
  return (
    <View style={styles.row}>
      <Text style={{color: tokens.textSecondary, fontSize: 13}}>{label}</Text>
      <Text style={{color: tokens.text, fontSize: 13, fontWeight: '500'}}>
        {value}
      </Text>
    </View>
  );
}

function EmptyRow({
  text,
  tokens,
}: {
  text: string;
  tokens: ThemeTokensShape;
}) {
  return (
    <Text style={{color: tokens.textSecondary, fontSize: 13, paddingVertical: 6}}>
      {text}
    </Text>
  );
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
});
