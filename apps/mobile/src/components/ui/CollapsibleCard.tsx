/**
 * Shared collapsible card (collapsible-rn): pressable header (title + collapsed
 * summary + chevron) over expandable content.
 *
 * 受控 / 非受控两用：传 `expanded` + `onToggle` 为受控，只传 `defaultExpanded`
 * 为非受控。`collapsible={false}` 表达「短内容不可折叠」形态（锁定在当前展开态、
 * 无 chevron 与切换）。`pressArea="card"` 时整个卡片可按（结果卡片形态）。
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import {useTheme} from '@/theme/ThemeProvider';

export type CollapsibleCardProps = {
  /** 头部主内容（始终可见；调用方自带样式）。 */
  title: React.ReactNode;
  /** 收起态摘要（仅收起时渲染在 title 下方）。 */
  summary?: React.ReactNode;
  /** 展开态内容（仅展开时渲染）。 */
  children?: React.ReactNode;
  /** 受控展开态；不传则非受控。 */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (next: boolean) => void;
  /** false = 锁定在 `expanded ?? defaultExpanded` 态，不可折叠（短内容）。 */
  collapsible?: boolean;
  /** 按压区域：默认仅头部可按；`card` 整卡可按（结果卡片形态）。 */
  pressArea?: 'header' | 'card';
  /** 是否渲染 ▶/▼ chevron（结果卡片用文字提示代替）。 */
  showChevron?: boolean;
  /** 展开内容下沿的 hairline 分隔线（thinking / tool group 卡片）。 */
  showDividerBelow?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  chevronStyle?: StyleProp<ViewStyle>;
};

export function CollapsibleCard({
  title,
  summary,
  children,
  expanded: expandedProp,
  defaultExpanded = false,
  onToggle,
  collapsible = true,
  pressArea = 'header',
  showChevron = true,
  showDividerBelow = false,
  accessibilityLabel,
  testID,
  style,
  headerStyle,
  contentStyle,
  chevronStyle,
}: CollapsibleCardProps) {
  const {tokens} = useTheme();
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded);
  const isExpanded = expandedProp ?? expandedInternal;

  const handleToggle = collapsible
    ? () => {
        const next = !isExpanded;
        if (expandedProp == null) {
          setExpandedInternal(next);
        }
        onToggle?.(next);
      }
    : undefined;

  const headerNode = (
    <View style={styles.headerText}>
      {title}
      {!isExpanded && summary != null ? summary : null}
    </View>
  );

  const chevronNode = showChevron ? (
    <Text style={[styles.chevron, {color: tokens.textTertiary}, chevronStyle]}>
      {isExpanded ? '▼' : '▶'}
    </Text>
  ) : null;

  const contentNode = isExpanded ? (
    <View
      style={[
        showDividerBelow && {
          borderBottomColor: tokens.borderLight,
          borderBottomWidth: StyleSheet.hairlineWidth,
          marginBottom: 8,
          paddingBottom: 8,
        },
        contentStyle,
      ]}
    >
      {children}
    </View>
  ) : null;

  if (pressArea === 'card') {
    return (
      <Pressable
        testID={testID}
        onPress={handleToggle}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityState={collapsible ? {expanded: isExpanded} : undefined}
        style={style}
      >
        {headerNode}
        {contentNode}
      </Pressable>
    );
  }

  return (
    <View style={style}>
      <Pressable
        testID={testID}
        onPress={handleToggle}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityState={collapsible ? {expanded: isExpanded} : undefined}
        style={[styles.header, headerStyle]}
      >
        {headerNode}
        {chevronNode}
      </Pressable>
      {contentNode}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {flex: 1, minWidth: 0},
  chevron: {fontSize: 10},
});
