/**
 * workplace 文件列表卡（常驻工作区段）：**无组头**——轮摘要已标 workplace，
 * 点轮展开直接见文件列表（每行 = 路径 + 展示档，单行不预览正文）；点文件行
 * 就地展开该文件的预览卡（块内正文预览）；点预览卡才进全屏看完整正文——
 * 用户拍板的层级：轮 → 文件列表 → 预览 → 全屏（不再嵌 workplace 组）。
 *
 * 数据源是 core 的 `ctx.workplaceFiles`（`assembleWorkplaceDisplay` 从 session
 * kkv 规则快照源头顺产，不从展示串反解）。
 *
 * 文件级展开态**受控**（`openGroupIds` 前缀 key / `onToggleFile`，key =
 * `${card.id}:${path}` 落在屏级集合——FlatList 虚拟化卸载不丢态）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {PromptWorkplaceCardData} from '@novel-master/core/prompt';
import {useOpenPromptDetail} from './PromptTurnCard';
import {useTheme} from '@/theme/ThemeProvider';

/** 展示档文案：与 VFS/工作区侧 `displayStateLabel` 同源（全内容/文件头/文件名）。 */
const DISPLAY_LABEL: Record<PromptWorkplaceCardData['files'][number]['display'], string> = {
  full: '全内容',
  filename: '文件名',
  header: '文件头',
};

type Props = {
  card: PromptWorkplaceCardData;
  turnId: string;
  /** 屏级展开集合原样透传：文件级 key = `${card.id}:${path}` 由组件内逐行
   * O(1) 查询（免得每次渲染新建过滤 Set，也避免父层在 map 回调里用 hook）。 */
  openGroupIds: ReadonlySet<string>;
  /** 文件行点按：toggle 该文件的预览卡。 */
  onToggleFile: (path: string) => void;
};

export function PromptWorkplaceCard({
  card,
  turnId,
  openGroupIds,
  onToggleFile,
}: Props) {
  const {tokens} = useTheme();
  const openDetail = useOpenPromptDetail();

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
      <View testID="prompt-workplace-list" style={styles.list}>
        {card.files.map(file => {
          const fileOpen = openGroupIds.has(`${card.id}:${file.path}`);
          return (
            <View key={file.path} style={styles.fileBlock}>
              {/* 轮 → 文件列表：单行路径 + 展示档（无正文）。 */}
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
              {/* 列表行 → 预览卡（点它进全屏）。 */}
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
                    style={[styles.code, {color: tokens.text}]}
                    numberOfLines={6}>
                    {file.body}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // blockCard 形态（与叶子/工具组卡同层的列表壳，无组头）：1px 边 + 左 3px 粗条。
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 10,
  },
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
  // 预览卡：列表行下方展开（第三层白底浮起 + 细左条）。
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  code: {fontFamily: 'monospace', fontSize: 11, lineHeight: 16},
});
