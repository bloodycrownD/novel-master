/**
 * 轮摘要卡（三层结构第一层，默认收起）：role 徽标 + 单行真摘要 + 单行计数行 +
 * `⤢` 整轮全屏 + chevron；点头部就地展开（受控），展开区挂载 `children` 卡片流。
 *
 * 视觉对齐智能体配置页（AgentEditor）卡片体系：外层 = FormSectionCard 形态
 * （surfaceElevated 底 + 大圆角 + 浅阴影浮起）；子卡（组卡/叶子卡）自带
 * 「1px 边 + 左侧 3px primary 粗条」的 blockCard 形态表达嵌套，本层不再画竖线。
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
import type {
  PromptPreviewTurn,
  PromptTurnCardData,
} from '@novel-master/core/prompt';
import type {RootStackParamList} from '@/navigation/types';
import {setPromptTurnDetail} from './prompt-turn-callback';
import {useTheme} from '@/theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 详情页 header 标题上限：卡片摘要照原样展示，进详情只截首段避免顶栏塞满。 */
const DETAIL_TITLE_LIMIT = 24;

/**
 * 悬挂 use 的占位文案（result 为 null，槽位保留不隐藏）。
 *
 * 常量定义留在本模块（叶子模块）并导出：组卡占位格与整轮全屏的组卡 result 段
 * 共用同一份文案，而 PromptToolGroupCard 本就依赖本模块（取 `useOpenPromptDetail`），
 * 反向再引一次不成环。
 */
export const LOST_RESULT_TEXT = '未返回结果';

/**
 * 整轮全屏正文 = cards 逐卡正文，组卡拆两格（对齐 desktop cardBodies/toolGroupLeaves 口径）。
 *
 * 不读 `turn.body`：那是 CLI parity 冻结面的「`[段名]` 前缀平铺串」，工具段还是旧粒度
 * （一条消息多个 result 合并），正是本次重设计要消灭的形态。mobile 顺序拼接后整段渲染，
 * 与 desktop 的按块逐段渲染是同一份内容序列。
 */
function fullscreenBodies(cards: ReadonlyArray<PromptTurnCardData>): string {
  return cards
    .flatMap(c =>
      c.type === 'toolGroup'
        ? [c.inputJson, c.result?.body ?? LOST_RESULT_TEXT]
        : [c.body],
    )
    .filter(t => t !== '')
    .join('\n\n');
}

/**
 * 轮层 role 徽标（不是消息角色，是「轮」这一层）文案与 badge 配色。
 * 对齐智能体配置 `.config-block-card__badge` 的 pill 形态与对话页
 * 「user=主蓝气泡、assistant=中性」的全局先例：user 主蓝底白字、
 * assistant 灰底正文色、template（系统段）描边弱化。深浅主题自动跟随。
 */
const TURN_ROLE_LABEL: Record<PromptPreviewTurn['kind'], string> = {
  user: 'user',
  assistant: 'assistant',
  template: 'template',
};

function roleBadgeStyle(
  tokens: ReturnType<typeof useTheme>['tokens'],
  kind: PromptPreviewTurn['kind'],
) {
  if (kind === 'user') {
    return {backgroundColor: tokens.primary, color: '#fff'};
  }
  if (kind === 'assistant') {
    return {backgroundColor: tokens.bgSecondary, color: tokens.text};
  }
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.borderLight,
    color: tokens.textTertiary,
  };
}

/** 标题截断口径（详情页 header 与卡片标题同一上限）。 */
function promptDetailTitle(summary: string): string {
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

  const roleBadge = roleBadgeStyle(tokens, turn.kind);
  const openDetail = useOpenPromptDetail();
  const roleLabel = TURN_ROLE_LABEL[turn.kind];
  // 无障碍标签不能只有动作名：多轮多卡时读屏全念同一个词，靠摘要尾巴才区分得开。
  const summaryTail = turn.summaryText.slice(0, 20);
  const headLabel = `${expanded ? '收起' : '展开'}${roleLabel}轮，${summaryTail}`;

  const handleToggle = useCallback(() => {
    onToggle(turn.id);
  }, [onToggle, turn.id]);

  const handleFullscreen = useCallback(
    (event?: {stopPropagation?: () => void}) => {
      // 嵌套 Pressable：阻止冒泡到头部，否则「点 ⤢ 进全屏」会同时把轮展开。
      event?.stopPropagation?.();
      openDetail({
        title: turn.summaryText,
        body: fullscreenBodies(turn.cards),
        turnId: turn.id,
      });
    },
    [openDetail, turn.id, turn.summaryText, turn.cards],
  );

  return (
    <View
      testID="prompt-turn-card"
      style={[
        styles.card,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: tokens.borderLight,
        },
      ]}
    >
      <Pressable
        testID="prompt-turn-head"
        accessibilityRole="button"
        accessibilityLabel={headLabel}
        accessibilityState={{expanded}}
        onPress={handleToggle}
        style={styles.header}
      >
        <Text
          testID="prompt-turn-role"
          style={[styles.role, roleBadge]}
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
          accessibilityLabel={`整轮全屏，${roleLabel} ${summaryTail}`}
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
  // 外层轮卡 = FormSectionCard 形态（智能体配置卡片体系）：surfaceElevated 底、
  // 16 圆角、浅阴影 + elevation 浮起；子卡的 3px 左条负责表达嵌套从属。
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // role 徽标 pill（对齐 .config-block-card__badge：2×8 内衬 / 6 圆角 / 11·600）。
  role: {
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  summary: {fontSize: 13, lineHeight: 18, flexShrink: 1, flexGrow: 1},
  meta: {fontSize: 11, lineHeight: 16, flexShrink: 1, flexGrow: 1},
  iconBtn: {paddingHorizontal: 2},
  icon: {fontSize: 13},
  chevron: {fontSize: 16},
  body: {marginTop: 12, gap: 12},
});