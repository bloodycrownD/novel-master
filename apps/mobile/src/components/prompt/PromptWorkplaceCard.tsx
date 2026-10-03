/**
 * workplace 组卡（常驻工作区段）：组头「workplace · N 文件」收起，就地展开后
 * 逐文件一张小卡——路径 + 展示档（全文/仅文件名/头信息，kkv 规则快照原值）+
 * 块内正文预览；点文件卡进全屏看该文件完整块内正文。
 *
 * 数据源是 core 的 `ctx.workplaceFiles`（`assembleWorkplaceDisplay` 从 session
 * kkv 规则快照源头顺产，不从展示串反解——用户拍板）。
 *
 * 展开态同样**受控**（`expanded` / `onToggle`，与工具组卡共用屏级 openGroupIds）：
 * FlatList 虚拟化会卸载滚出窗口的 item，组件内 state 会丢。
 *
 * 形态与工具组卡同款（blockCard 左 3px 粗条 + 组头一行）；文件小卡与工具格
 * 同层（白底浮起、细左条）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {PromptWorkplaceCardData} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** 展示档文案（三态可读，规则快照原值直译）。 */
const DISPLAY_LABEL: Record<PromptWorkplaceCardData['files'][number]['display'], string> = {
  full: '全文',
  filename: '仅文件名',
  header: '头信息',
};

type Props = {
  card: PromptWorkplaceCardData;
  turnId: string;
  expanded: boolean;
  onToggle: (groupId: string) => void;
};

export function PromptWorkplaceCard({card, turnId, expanded, onToggle}: Props) {
  const {tokens} = useTheme();
  const openDetail = useOpenPromptDetail();

  const handleToggle = useCallback(() => {
    onToggle(card.id);
  }, [onToggle, card.id]);

  const openFile = useCallback(
    (path: string, body: string) => {
      openDetail({
        title: path,
        body,
        leafId: `${card.id}:${path}`,
        turnId,
      });
    },
    [openDetail, card.id, turnId],
  );

  return (
    <View
      testID="prompt-workplace-card"
      style={[
        styles.card,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.border,
          borderLeftColor: tokens.primary,
        },
      ]}>
      <Pressable
        testID="prompt-workplace-head"
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? '收起' : '展开'}工作区文件 ${card.files.length} 个`}
        accessibilityState={{expanded}}
        onPress={handleToggle}
        style={styles.head}>
        <View testID="prompt-workplace-title" style={styles.headLeft}>
          <Text
            testID="prompt-workplace-name"
            style={[styles.name, {color: tokens.text}]}
            numberOfLines={1}>
            workplace
          </Text>
          <Text
            testID="prompt-workplace-count"
            style={[styles.count, {color: tokens.textSecondary}]}
            numberOfLines={1}>
            {card.files.length} 文件
          </Text>
        </View>
        <Text
          testID="prompt-workplace-chevron"
          style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </Pressable>
      {expanded ? (
        <View testID="prompt-workplace-body" style={styles.cells}>
          {card.files.map(file => (
            <Pressable
              key={file.path}
              testID="prompt-workplace-file"
              accessibilityRole="button"
              accessibilityLabel={`查看工作区文件 ${file.path}`}
              onPress={() => openFile(file.path, file.body)}
              style={[
                styles.cell,
                {
                  backgroundColor: tokens.surface,
                  borderColor: tokens.borderLight,
                  borderLeftColor: tokens.primary,
                },
              ]}>
              <View style={styles.cellHead}>
                <Text
                  testID="prompt-workplace-file-path"
                  style={[styles.path, {color: tokens.text}]}
                  numberOfLines={1}>
                  {file.path}
                </Text>
                <Text
                  testID="prompt-workplace-file-display"
                  style={[
                    styles.display,
                    {color: tokens.textSecondary, borderColor: tokens.borderLight},
                  ]}
                  numberOfLines={1}>
                  {DISPLAY_LABEL[file.display]}
                </Text>
              </View>
              <Text
                testID="prompt-workplace-file-preview"
                style={[styles.code, {color: tokens.textSecondary}]}
                numberOfLines={6}>
                {file.body}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // blockCard 形态（与工具组卡同款，组头收窄版）：1px 边 + 左 3px 粗条。
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28},
  headLeft: {flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1},
  name: {fontSize: 14, fontWeight: '600', flexShrink: 1},
  count: {fontSize: 11},
  chevron: {fontSize: 14, marginLeft: 'auto'},
  cells: {gap: 8},
  // 文件小卡：第三层，白底浮起（明度交替最末档）+ 细左条。
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  cellHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  path: {
    fontFamily: 'monospace',
    fontSize: 12,
    flexShrink: 1,
  },
  // 展示档 pill（badge 形态描边款）。
  display: {
    fontSize: 10,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 1,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  code: {fontFamily: 'monospace', fontSize: 11, lineHeight: 16},
});
