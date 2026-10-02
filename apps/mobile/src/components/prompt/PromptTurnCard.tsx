/**
 * 轮摘要卡（三层结构第一层，默认收起）：role 徽标 + 单行真摘要 + 单行计数行 +
 * `⤢` 整轮全屏 + chevron；点头部就地展开（受控），展开区挂载 `children` 卡片流。
 *
 * 展开态**受控**（`expanded` / `onToggle`）而不是组件内 state：展开区在 FlatList
 * 里，`removeClippedSubviews` 会把滚出窗口的 item 卸载掉，组件内 state 随之丢失，
 * 用户滚回来会发现展开态被重置。状态提升到 `RealPromptScreen`（屏级
 * `openTurnIds` / `openGroupIds`），滚动只丢渲染不丢状态。
 *
 * 导航依赖**故意收在组件内**：`RealPromptScreen` 顶层只 import `useRoute`
 * （既有 __tests__/real-prompt-screen-scope.test.tsx 对 @react-navigation/native
 * 整模块 mock 只提供 useRoute，屏顶层一旦新增 useNavigation，T-AM3 三条用例
 * 会在渲染期即炸）。`useNavigation` 在这里自取，FlatList 桩不渲染本组件，
 * 故那三条用例不受影响。
 *
 * 轮正文可达数百 KB，不走路由参数：点按前经 prompt-turn-callback 模块级存取
 * 交给 PromptTurnDetailScreen（路由 params 只带可序列化的短标题与轮 id）。
 */
import React, {useCallback} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {PromptPreviewTurn} from '@novel-master/core/prompt';
import type {RootStackParamList} from '@/navigation/types';
import {setPromptTurnDetail} from './prompt-turn-callback';
import {useTheme} from '@/theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 详情页 header 标题上限：卡片摘要照原样展示，进详情只截首段避免顶栏塞满。 */
const DETAIL_TITLE_LIMIT = 24;

/**
 * 轮层 role 徽标（不是消息角色，是「轮」这一层）：三类轮的徽标文案与配色
 * 与设计基准 demo 的 turn-head 一致（user 青 / assistant 紫 / template 灰）。
 */
const TURN_ROLE_LABEL: Record<PromptPreviewTurn['kind'], string> = {
  user: 'user 轮',
  assistant: 'assistant 轮',
  template: 'template 轮',
};

/** 徽标配色：user 青、assistant 紫、template 中性灰（不随主题变，语义色）。 */
const TURN_ROLE_COLOR: Record<PromptPreviewTurn['kind'], string> = {
  user: '#2dd4bf',
  assistant: '#a78bfa',
  template: '#9ca3af',
};

/** 导出给组卡/叶子卡复用的标题截断口径（详情页 header 与卡片标题同一上限）。 */
export function promptDetailTitle(summary: string): string {
  return summary.length > DETAIL_TITLE_LIMIT
    ? `${summary.slice(0, DETAIL_TITLE_LIMIT - 1)}…`
    : summary;
}

/**
 * 叶子级全屏的统一出口：写回调载荷 → navigate。
 *
 * 路由 params 只带可序列化的短标题与轮 id（`turnId` 是轮内 id，作详情页
 * `FileMarkdownPreview` 的稳定伪 path key），正文永远走模块级单例。
 */
export function useOpenPromptDetail() {
  const navigation = useNavigation<Nav>();
  return useCallback(
    (payload: {title: string; body: string; leafId?: string; turnId: string}) => {
      const title = promptDetailTitle(payload.title);
      setPromptTurnDetail(
        payload.leafId === undefined
          ? {title, body: payload.body}
          : {title, body: payload.body, leafId: payload.leafId},
      );
      navigation.navigate('PromptTurnDetail', {title, turnId: payload.turnId});
    },
    [navigation],
  );
}

type Props = {
  turn: PromptPreviewTurn;
  /** 就地展开态由屏级受控（FlatList 虚拟化会卸载 item，组件内 state 会丢）。 */
  expanded: boolean;
  /** 展开/收起回调（实参带轮 id，屏级据此增删 `openTurnIds`）。 */
  onToggle: (turnId: string) => void;
  /** 展开区内容（卡片流），仅 `expanded` 时挂载。 */
  children?: React.ReactNode;
};

export function PromptTurnCard({turn, expanded, onToggle, children}: Props) {
  const {tokens} = useTheme();
  const openDetail = useOpenPromptDetail();
  const roleLabel = TURN_ROLE_LABEL[turn.kind] ?? turn.kind;
  const roleColor = TURN_ROLE_COLOR[turn.kind] ?? TURN_ROLE_COLOR.template;

  const handleToggle = useCallback(() => {
    onToggle(turn.id);
  }, [onToggle, turn.id]);

  const handleFullscreen = useCallback(
    (event?: {stopPropagation?: () => void}) => {
      // 嵌套 Pressable：阻止冒泡到头部，否则「点 ⤢ 进全屏」会同时把轮展开。
      event?.stopPropagation?.();
      openDetail({title: turn.summaryText, body: turn.body, turnId: turn.id});
    },
    [openDetail, turn.id, turn.summaryText, turn.body],
  );

  return (
    <View
      testID="prompt-turn-card"
      style={[
        styles.card,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.borderLight,
        },
      ]}
    >
      <Pressable
        testID="prompt-turn-head"
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起轮详情' : '展开轮详情'}
        onPress={handleToggle}
        style={styles.header}
      >
        <Text
          testID="prompt-turn-role"
          style={[styles.role, {color: roleColor}]}
          numberOfLines={1}>
          {roleLabel}
        </Text>
        <Text
          testID="prompt-turn-summary"
          style={[styles.summary, {color: tokens.text}]}
          numberOfLines={1}>
          {turn.summaryText}
        </Text>
        <Text
          testID="prompt-turn-meta"
          style={[styles.meta, {color: tokens.textTertiary}]}
          numberOfLines={1}>
          {turn.metaText}
        </Text>
        <Pressable
          testID="prompt-turn-fullscreen"
          accessibilityRole="button"
          accessibilityLabel="整轮全屏"
          hitSlop={6}
          onPress={handleFullscreen}
          style={styles.iconBtn}>
          <Text style={[styles.icon, {color: tokens.textTertiary}]}>⤢</Text>
        </Pressable>
        <Text
          testID="prompt-turn-chevron"
          style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </Pressable>
      {expanded ? (
        <View testID="prompt-turn-body" style={styles.body}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  role: {fontSize: 12, fontWeight: '700', flexShrink: 0},
  summary: {fontSize: 13, lineHeight: 18, flexShrink: 1, flexGrow: 1},
  meta: {fontSize: 11, lineHeight: 16, flexShrink: 1, flexGrow: 1},
  iconBtn: {paddingHorizontal: 2},
  icon: {fontSize: 13},
  chevron: {fontSize: 16},
  body: {marginTop: 8, gap: 8},
});