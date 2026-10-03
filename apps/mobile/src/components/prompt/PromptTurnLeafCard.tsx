/**
 * 叶子卡（文本 / thinking）：限 6 行预览，整卡点按进全屏原文。
 *
 * 无 kind 小标题行（用户拍板：轮层徽标已标 role，卡片内再标一遍 user/assistant
 * 纯冗余；thinking 与正文靠内容本身区分）、无显式 ⤢（点击就好进入全屏）。
 *
 * 视觉对齐智能体配置 blockCard 体系（与工具组卡同层同款）：1px 边 +
 * 左侧 3px primary 粗条 + 10 圆角；底色沉一档（bgSecondary，白轮卡内
 * 「灰→白→灰→白」明度交替的中层）。
 *
 * 叶子卡是「就地展开 → 全屏」链路的最末端：预览只给六行，全文走详情页
 * （原文纯文本铺开，可长按复制）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import type {PromptTextCardData} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** 详情页标题：thinking 卡单独叫「thinking」，其余读 core 给的 role 展示标签。 */
function promptLeafTitle(card: PromptTextCardData): string {
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

  const handlePress = useCallback(() => {
    openDetail({
      title: promptLeafTitle(card),
      body: card.body,
      leafId: card.id,
      turnId,
    });
  }, [openDetail, card, turnId]);

  return (
    <Pressable
      testID="prompt-turn-leaf-card"
      accessibilityRole="button"
      accessibilityLabel={`${promptLeafTitle(card)}，${card.body.slice(0, 20)}`}
      onPress={handlePress}
      style={[
        styles.card,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.border,
          borderLeftColor: tokens.primary,
        },
      ]}>
      <Text
        testID="prompt-turn-leaf-preview"
        style={[styles.preview, {color: tokens.textSecondary}]}
        numberOfLines={6}>
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
  },
  preview: {fontSize: 12, lineHeight: 17},
});
