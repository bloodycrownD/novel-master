/**
 * 叶子卡（文本 / thinking）：kind 标签 + 显式 `⤢` 全屏入口 + 限 2 行预览，整卡也可点。
 *
 * 视觉对齐智能体配置 blockCard 体系（与工具组卡同层同款）：1px 边 +
 * 左侧 3px primary 粗条 + 10 圆角 + surface 底；kind 标签 pill 化（badge 形态）。
 *
 * 叶子卡是「就地展开 → 全屏」链路的最末端：预览只给两行，全文走详情页的
 * rich 渲染管线（`FileMarkdownPreview` 的 `renderKind='rich'`，详情页内可切原文档）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {PromptTextCardData} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** kind 徽标文案：thinking 卡单独叫「thinking」，其余读 core 给的 role 展示标签。 */
function promptLeafKindLabel(card: PromptTextCardData): string {
  if (card.type === 'thinking') {
    return 'thinking';
  }
  return card.role === '' ? '文本' : card.role;
}

type Props = {
  card: PromptTextCardData;
  turnId: string;
};

export function PromptTurnLeafCard({card, turnId}: Props) {
  const {tokens} = useTheme();
  const openDetail = useOpenPromptDetail();

  const handlePress = useCallback(
    (event?: {stopPropagation?: () => void}) => {
      // ⤢ 嵌在整卡 Pressable 里：阻止冒泡，否则一次点按触发两次 navigate 推两层栈。
      event?.stopPropagation?.();
      openDetail({
        title: promptLeafKindLabel(card),
        body: card.body,
        leafId: card.id,
        turnId,
      });
    },
    [openDetail, card, turnId],
  );

  return (
    <Pressable
      testID="prompt-turn-leaf-card"
      accessibilityRole="button"
      accessibilityLabel={`${promptLeafKindLabel(card)}，${card.body.slice(0, 20)}`}
      onPress={handlePress}
      style={[
        styles.card,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
          borderLeftColor: tokens.primary,
        },
      ]}>
      <View style={styles.kindRow}>
        <Text
          testID="prompt-turn-leaf-kind"
          style={[
            styles.kind,
            {color: tokens.textSecondary, borderColor: tokens.borderLight},
          ]}
          numberOfLines={1}>
          {promptLeafKindLabel(card)}
        </Text>
        <Pressable
          testID="prompt-turn-leaf-fullscreen"
          accessibilityRole="button"
          accessibilityLabel={`${promptLeafKindLabel(card)}全屏`}
          hitSlop={6}
          onPress={handlePress}
          style={styles.iconBtn}>
          <Text style={[styles.icon, {color: tokens.textTertiary}]}>⤢</Text>
        </Pressable>
      </View>
      <Text
        testID="prompt-turn-leaf-preview"
        style={[styles.preview, {color: tokens.textSecondary}]}
        numberOfLines={2}>
        {card.body}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // blockCard 形态（智能体配置同款）：1px 边 + 左 3px primary 粗条 + 10 圆角。
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 24,
  },
  // kind 标签 pill（badge 形态）：描边款，thinking 由文案本身区分。
  kind: {
    fontSize: 10,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 1,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  iconBtn: {paddingHorizontal: 2},
  icon: {fontSize: 12},
  preview: {fontSize: 12, lineHeight: 17},
});