/**
 * 工具组卡（一次 `tool_use` 一张）：组头「工具名 · 状态点」+ 可选「并行」徽标，
 * 就地展开后是 **一对两格**——左格 tool use（等宽 JSON 预览）、右格 tool result
 * （正文预览 / 悬挂时「未返回结果」占位）。两格各自可点进全屏富文本。
 *
 * 展开态同样**受控**（`expanded` / `onToggle`）：理由同 PromptTurnCard——
 * 轮卡展开区在 FlatList 里会被虚拟化卸载，组件内 state 会丢。
 *
 * 状态点配色：ok 绿 / error 红 / lost 灰（语义色，不随主题变）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {PromptToolGroupCardData} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** 悬挂 use 的占位文案（result 为 null，槽位保留不隐藏）。 */
const LOST_RESULT_TEXT = '未返回结果';

const STATUS_COLOR: Record<PromptToolGroupCardData['status'], string> = {
  ok: '#34c759',
  error: '#f87171',
  lost: '#9ca3af',
};

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
        {backgroundColor: tokens.bgSecondary, borderColor: tokens.borderLight},
      ]}>
      <Pressable
        testID="prompt-tool-group-head"
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起工具调用' : '展开工具调用'}
        onPress={handleToggle}
        style={styles.head}>
        <View testID="prompt-tool-group-status" style={styles.headLeft}>
          <View
            testID={`prompt-tool-group-dot-${card.status}`}
            style={[styles.dot, {backgroundColor: STATUS_COLOR[card.status]}]}
          />
          <Text
            testID="prompt-tool-group-name"
            style={[styles.name, {color: tokens.text}]}
            numberOfLines={1}>
            {card.toolName}
          </Text>
          {card.parallel ? (
            <Text testID="prompt-tool-group-parallel" style={styles.parallel}>
              并行
            </Text>
          ) : null}
          <Text
            testID="prompt-tool-group-status-label"
            style={[styles.statusLabel, {color: STATUS_COLOR[card.status]}]}
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
            accessibilityLabel="查看工具入参"
            onPress={openUse}
            style={[styles.cell, {borderColor: tokens.borderLight}]}>
            <Text
              style={[styles.cellLabel, {color: tokens.textTertiary}]}
              numberOfLines={1}>
              tool use
            </Text>
            <Text
              testID="prompt-tool-group-use-preview"
              style={[styles.code, {color: tokens.text}]}
              numberOfLines={3}>
              {card.inputJson}
            </Text>
          </Pressable>
          <Pressable
            testID="prompt-tool-group-result"
            accessibilityRole="button"
            accessibilityLabel="查看工具结果"
            onPress={openResult}
            style={[styles.cell, {borderColor: tokens.borderLight}]}>
            <Text
              style={[styles.cellLabel, {color: tokens.textTertiary}]}
              numberOfLines={1}>
              tool result
            </Text>
            <Text
              testID="prompt-tool-group-result-preview"
              style={[
                styles.code,
                card.result == null && {color: tokens.textTertiary},
              ]}
              numberOfLines={3}>
              {card.result == null ? LOST_RESULT_TEXT : card.result.body}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 8},
  headLeft: {flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1},
  dot: {width: 8, height: 8, borderRadius: 4},
  name: {fontSize: 13, fontWeight: '600', flexShrink: 1},
  parallel: {
    fontSize: 10,
    color: '#a78bfa',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#a78bfa',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  statusLabel: {fontSize: 11},
  chevron: {fontSize: 14, marginLeft: 'auto'},
  cells: {marginTop: 8, gap: 8},
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 4,
  },
  cellLabel: {fontSize: 10, letterSpacing: 0.5},
  code: {fontFamily: 'monospace', fontSize: 11, lineHeight: 16},
});