/**
 * 工具组卡（一次 `tool_use` 一张）：组头「工具名 · 状态点」+ 可选「并行」徽标，
 * 就地展开后是 **一对两格**——左格 tool use（等宽 JSON 预览）、右格 tool result
 * （正文预览 / 悬挂时「未返回结果」占位）。整格点按进全屏（无显式 ⤢，
 * 用户拍板「点击就好进入全屏」）；悬挂占位格不挂 onPress（假入口不留）。
 *
 * 展开态同样**受控**（`expanded` / `onToggle`）：理由同 PromptTurnCard——
 * 轮卡展开区在 FlatList 里会被虚拟化卸载，组件内 state 会丢。
 *
 * 视觉对齐智能体配置 blockCard 体系（PersistBlocksCard 同款）：1px 边 +
 * **左侧 3px primary 粗条** + 10 圆角；底色走「灰→白→灰→白」明度交替
 * （对齐智能体页「灰页→白分区卡→灰块→白输入框」的观感规律）：子卡沉一档
 * （bgSecondary 灰底），组头 40 高（blockHeader）、工具名 15·600（blockName）；
 * 格子回到白底浮起（最内层）。
 *
 * tool use 预览走 core `formatToolUsePreviewJson`（保结构截大 key：超长字符串
 * 值截断、超长数组截项），不直接腰斩 pretty JSON——结构可读性优先；全屏仍看
 * `inputJson` 原文。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {PromptToolGroupCardData} from '@novel-master/core/prompt';
import {formatToolUsePreviewJson} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** 悬挂 use 的占位文案（result 为 null，槽位保留不隐藏）。 */
const LOST_RESULT_TEXT = '未返回结果';

/**
 * 状态点配色走主题 token（成功/危险/中性，对齐 app 工具卡先例 ToolCallCard 的
 * statusColor 语义色体系，深浅主题自动跟随）；状态文字仍为正文色（见 statusLabel）。
 */
const statusDotColor = (
  tokens: ReturnType<typeof useTheme>['tokens'],
  status: PromptToolGroupCardData['status'],
) =>
  status === 'ok'
    ? tokens.success
    : status === 'error'
      ? tokens.danger
      : tokens.textTertiary;

/** 状态点旁的状态文案（三态可读，不只靠颜色区分）。 */
const STATUS_LABEL: Record<PromptToolGroupCardData['status'], string> = {
  ok: '成功',
  error: '失败',
  lost: '丢失',
};

type Props = {
  card: PromptToolGroupCardData;
  turnId: string;
  expanded: boolean;
  onToggle: (groupId: string) => void;
};

export function PromptToolGroupCard({card, turnId, expanded, onToggle}: Props) {
  const {tokens} = useTheme();
  const openDetail = useOpenPromptDetail();

  const handleToggle = useCallback(() => {
    onToggle(card.id);
  }, [onToggle, card.id]);

  const openUse = useCallback(() => {
    openDetail({
      title: `tool use · ${card.toolName}`,
      body: card.inputJson,
      leafId: `${card.id}-use`,
      turnId,
    });
  }, [openDetail, card.id, card.toolName, card.inputJson, turnId]);

  const openResult = useCallback(() => {
    openDetail({
      title: `tool result · ${card.toolName}`,
      body: card.result?.body ?? '',
      leafId: `${card.id}-result`,
      turnId,
    });
  }, [openDetail, card.id, card.toolName, card.result, turnId]);

  return (
    <View
      testID="prompt-tool-group-card"
      style={[
        styles.card,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.border,
          borderLeftColor: tokens.primary,
        },
      ]}>
      <Pressable
        testID="prompt-tool-group-head"
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? '收起' : '展开'}工具调用 ${card.toolName}`}
        accessibilityState={{expanded}}
        onPress={handleToggle}
        style={styles.head}>
        <View testID="prompt-tool-group-status" style={styles.headLeft}>
          <View
            testID={`prompt-tool-group-dot-${card.status}`}
            style={[styles.dot, {backgroundColor: statusDotColor(tokens, card.status)}]}
          />
          <Text
            testID="prompt-tool-group-name"
            style={[styles.name, {color: tokens.text}]}
            numberOfLines={1}>
            {card.toolName}
          </Text>
          {card.parallel ? (
            <Text
              testID="prompt-tool-group-parallel"
              // 对齐 desktop 的中性色虚线徽标（role 徽标与状态三色是唯一的语义色留白）。
              style={[
                styles.parallel,
                {color: tokens.textTertiary, borderColor: tokens.borderLight},
              ]}>
              并行
            </Text>
          ) : null}
          {/* 状态文案用主题正文色：语义色浅底对比 1.86~2.54:1 低于 3:1 门槛，
              仅用于装饰性状态点（上面的 dot）；tokens 化另开迭代。 */}
          <Text
            testID="prompt-tool-group-status-label"
            style={[styles.statusLabel, {color: tokens.text}]}
            numberOfLines={1}>
            {STATUS_LABEL[card.status]}
          </Text>
        </View>
        <Text
          testID="prompt-tool-group-chevron"
          style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </Pressable>
      {expanded ? (
        <View testID="prompt-tool-group-body" style={styles.cells}>
          <Pressable
            testID="prompt-tool-group-use"
            accessibilityRole="button"
            accessibilityLabel={`查看工具入参，${card.toolName}`}
            onPress={openUse}
            style={[
              styles.cell,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.borderLight,
                borderLeftColor: tokens.primary,
              },
            ]}>
            <Text
              testID="prompt-tool-group-use-label"
              style={[
                styles.cellLabel,
                {color: tokens.textSecondary, borderColor: tokens.borderLight},
              ]}
              numberOfLines={1}>
              tool use
            </Text>
            <Text
              testID="prompt-tool-group-use-preview"
              style={[styles.code, {color: tokens.text}]}
              numberOfLines={24}>
              {formatToolUsePreviewJson(card.inputJson)}
            </Text>
          </Pressable>
          <Pressable
            testID="prompt-tool-group-result"
            accessibilityRole="button"
            accessibilityLabel={`查看工具结果，${card.toolName}`}
            // 悬挂 use 的占位格不挂 onPress：否则点进去是一份空正文（假入口）。
            onPress={card.result == null ? undefined : openResult}
            style={[
              styles.cell,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.borderLight,
                borderLeftColor: tokens.primary,
              },
            ]}>
            <Text
              testID="prompt-tool-group-result-label"
              style={[
                styles.cellLabel,
                {color: tokens.textSecondary, borderColor: tokens.borderLight},
              ]}
              numberOfLines={1}>
              tool result
            </Text>
            <Text
              testID="prompt-tool-group-result-preview"
              style={[
                styles.code,
                card.result == null && {color: tokens.textTertiary},
              ]}
              numberOfLines={24}>
              {card.result == null ? LOST_RESULT_TEXT : card.result.body}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // blockCard 形态（智能体配置 PersistBlocksCard 同款）：1px 边 + 左 3px 粗条；
  // 组头收窄（minHeight 28：只是一个函数名，不需要 40 高的块头）。
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28},
  headLeft: {flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1},
  dot: {width: 8, height: 8, borderRadius: 4},
  name: {fontSize: 14, fontWeight: '600', flexShrink: 1},
  parallel: {
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  statusLabel: {fontSize: 11},
  chevron: {fontSize: 14, marginLeft: 'auto'},
  cells: {gap: 10},
  // 格子：第三层，白底浮起（「灰→白→灰→白」明度交替的最末一档）+ 细一号左条与圆角。
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  // 格头标签 pill（badge 形态）：描边款，色随 textSecondary。
  cellLabel: {
    fontSize: 10,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 1,
    paddingHorizontal: 6,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  code: {fontFamily: 'monospace', fontSize: 11, lineHeight: 16},
});
