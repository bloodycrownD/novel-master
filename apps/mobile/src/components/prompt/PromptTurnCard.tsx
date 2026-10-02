/**
 * assistant 轮卡片（R4）：role 标 + 轮摘要 + 进入详情的箭头。
 *
 * 导航依赖**故意收在组件内部**：`RealPromptScreen` 顶层只 import `useRoute`
 * （既有 __tests__/real-prompt-screen-scope.test.tsx 对 @react-navigation/native
 * 整模块 mock 只提供 useRoute，屏顶层一旦新增 useNavigation，T-AM3 三条用例
 * 会在渲染期即炸）。`useNavigation` 在这里自取，FlatList 桩不渲染本组件，
 * 故那三条用例不受影响。
 *
 * 轮正文可达数百 KB，不走路由参数：点按前经 prompt-turn-callback 模块级存取
 * 交给 PromptTurnDetailScreen（路由 params 只带可序列化的短标题）。
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
 * assistant 轮的 role 标签（不是消息角色，是「轮」这一层）。
 * 文案与 desktop `RealPromptPanel` 的 ASSISTANT_TURN_LABEL 保持一致。
 */
const ASSISTANT_TURN_LABEL = 'assistant 轮';

type Props = {
  turn: PromptPreviewTurn;
};

function detailTitle(summary: string): string {
  return summary.length > DETAIL_TITLE_LIMIT
    ? `${summary.slice(0, DETAIL_TITLE_LIMIT - 1)}…`
    : summary;
}

export function PromptTurnCard({turn}: Props) {
  const {tokens} = useTheme();
  const navigation = useNavigation<Nav>();
  // 摘要标题要同时喂 callback 与路由参数，算一次复用。
  const title = detailTitle(turn.summary);

  const openDetail = useCallback(() => {
    setPromptTurnDetail({title, body: turn.body});
    navigation.navigate('PromptTurnDetail', {title});
  }, [navigation, title, turn.body]);

  return (
    <Pressable
      testID="prompt-turn-card"
      accessibilityRole="button"
      accessibilityLabel="查看轮详情"
      onPress={openDetail}
      style={[
        styles.card,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.borderLight,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.role, {color: tokens.primary}]} numberOfLines={1}>
          {ASSISTANT_TURN_LABEL}
        </Text>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      </View>
      <Text style={[styles.summary, {color: tokens.text}]} numberOfLines={2}>
        {turn.summary}
      </Text>
    </Pressable>
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
    justifyContent: 'space-between',
    gap: 8,
  },
  role: {fontSize: 12, fontWeight: '700'},
  chevron: {fontSize: 16},
  summary: {fontSize: 13, lineHeight: 18, marginTop: 4},
});