/**
 * workplace 组卡（常驻工作区段）：组头「workplace · N 文件」收起，展开后是
 * **紧凑文件列表**（每行 = 路径 + 展示档，单行不预览正文）；点文件行就地
 * 展开该文件的预览卡（块内正文预览）；点预览卡才进全屏看完整正文——
 * 用户拍板的三级结构（列表 → 预览 → 全屏）。
 *
 * 数据源是 core 的 `ctx.workplaceFiles`（`assembleWorkplaceDisplay` 从 session
 * kkv 规则快照源头顺产，不从展示串反解）。
 *
 * 两级展开态都**受控**：组级 `expanded` / `onToggle`（与工具组卡共用屏级
 * openGroupIds），文件级 `openFilePaths` / `onToggleFile`（key =
 * `${card.id}:${path}`，同样落在屏级集合——FlatList 虚拟化卸载不丢态）。
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
  /** 组级展开态（受控，与工具组卡共用屏级 openGroupIds）。 */
  expanded: boolean;
  onToggle: (groupId: string) => void;
  /** 展开中的文件路径集合（受控，屏级；key = `${card.id}:${path}` 的 path 段）。 */
  openFilePaths: ReadonlySet<string>;
  /** 文件行点按：toggle 该文件的预览卡。 */
  onToggleFile: (path: string) => void;
};

export function PromptWorkplaceCard({
  card,
  turnId,
  expanded,
  onToggle,
  openFilePaths,
  onToggleFile,
}: Props) {
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
        <View testID="prompt-workplace-list" style={styles.list}>
          {card.files.map(file => {
            const fileOpen = openFilePaths.has(file.path);
            return (
              <View key={file.path} style={styles.fileBlock}>
                {/* 第一级 → 第二级：文件列表行（纯路径，无正文）。 */}
                <Pressable
                  testID="prompt-workplace-file"
                  accessibilityRole="button"
                  accessibilityLabel={`${fileOpen ? '收起' : '展开'}文件预览 ${file.path}`}
                  accessibilityState={{expanded: fileOpen}}
                  onPress={() => onToggleFile(file.path)}
                  style={[
                    styles.fileRow,
                    {borderColor: tokens.borderLight},
                  ]}>
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
                  <Text
                    testID="prompt-workplace-file-chevron"
                    style={[styles.fileChevron, {color: tokens.textTertiary}]}>
                    {fileOpen ? '⌄' : '›'}
                  </Text>
                </Pressable>
                {/* 第二级 → 第三级：预览卡（点它进全屏）。 */}
                {fileOpen ? (
                  <Pressable
                    testID="prompt-workplace-file-preview"
                    accessibilityRole="button"
                    accessibilityLabel={`查看文件全文 ${file.path}`}
                    onPress={() => openFile(file.path, file.body)}
                    style={[
                      styles.preview,
                      {
                        backgroundColor: tokens.surface,
                        borderColor: tokens.borderLight,
                        borderLeftColor: tokens.primary,
                      },
                    ]}>
                    <Text
                      testID="prompt-workplace-file-preview-text"
                      style={[styles.code, {color: tokens.textSecondary}]}
                      numberOfLines={6}>
                      {file.body}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
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
  list: {gap: 2},
  fileBlock: {gap: 6},
  // 文件列表行：单行紧凑（路径 + 展示档 + chevron），底部 hairline 分隔。
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
  },
  path: {
    fontFamily: 'monospace',
    fontSize: 12,
    flexShrink: 1,
    flexGrow: 1,
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
  fileChevron: {fontSize: 13},
  // 预览卡：列表行下方缩进展开（第三层白底浮起 + 细左条）。
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  code: {fontFamily: 'monospace', fontSize: 11, lineHeight: 16},
});
