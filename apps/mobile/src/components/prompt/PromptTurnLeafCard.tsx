/**
 * 叶子卡（文本 / thinking）：kind 标签 + 限 2 行预览，整卡可点进全屏富文本。
 *
 * 叶子卡是「就地展开 → 全屏」链路的最末端：预览只给两行，全文走详情页的
 * rich 渲染管线（`FileMarkdownPreview` 的 `renderKind='rich'`）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
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

  const handlePress = useCallback(() => {
    openDetail({
      title: promptLeafKindLabel(card),
      body: card.body,
      leafId: card.id,
      turnId,
    });
  }, [openDetail, card, turnId]);

  return (
    <Pressable
      testID="prompt-turn-leaf-card"
      accessibilityRole="button"
      accessibilityLabel={`${promptLeafKindLabel(card)}，${card.body.slice(0, 20)}`}
      onPress={handlePress}
      style={[
        styles.card,
        {backgroundColor: tokens.bgSecondary, borderColor: tokens.borderLight},
      ]}>
      <Text
        testID="prompt-turn-leaf-kind"
        style={[styles.kind, {color: tokens.textTertiary}]}
        numberOfLines={1}>
        {promptLeafKindLabel(card)}
      </Text>
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
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 8,
    gap: 4,
  },
  kind: {fontSize: 10, letterSpacing: 0.5},
  preview: {fontSize: 12, lineHeight: 17},
});