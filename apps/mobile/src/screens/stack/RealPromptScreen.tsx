/**
 * Full-screen real prompt preview: 三层结构（轮摘要卡 → 就地展开卡片流 → 全屏富文本）。
 *
 * 展开态**屏级受控**（`openTurnIds` / `openGroupIds` 两个 Set）：轮卡展开区在
 * FlatList 里，`removeClippedSubviews` 会卸载滚出窗口的 item，组件内 state 随之
 * 丢失，用户滚回来会发现展开态被重置。屏级 state 只随数据重载清空。
 *
 * 导航红线：顶层**只** import `useRoute`，`useNavigation` 留在 PromptTurnCard
 * 内部（既有 scope 用例对 @react-navigation/native 整模块 mock 只有 useRoute）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {PromptPreviewTurn} from '@novel-master/core/prompt';
import {useRoute, type RouteProp} from '@react-navigation/native';
import {PromptTurnCard} from '@/components/prompt/PromptTurnCard';
import {PromptToolGroupCard} from '@/components/prompt/PromptToolGroupCard';
import {PromptTurnLeafCard} from '@/components/prompt/PromptTurnLeafCard';
import {PromptWorkplaceCard} from '@/components/prompt/PromptWorkplaceCard';
import {useMobileScope} from '@/hooks/useMobileScope';
import {useRuntime} from '@/hooks/useRuntime';
import {buildRealPromptPreviewTurns} from '@/services/prompt-preview.service';
import {AgentRunError} from '@/services/agent-run.service';
import {useTheme} from '@/theme/ThemeProvider';
import type {RootStackParamList} from '@/navigation/types';

export function RealPromptScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  // scope 优先取路由参数、缺省回落到全局 scope（AM-3）：
  // 只读 useMobileScope() 会在「后台通知栈外改 scope、栈顶却还停在别的会话详情页」
  // 时展示**别的会话**的提示词，而屏上不出现任何会话名、用户无从察觉。
  // 回落分支是防御性的：无参进栈的存量路径行为与修复前逐字一致。
  const route = useRoute<RouteProp<RootStackParamList, 'RealPrompt'>>();
  const params = route.params ?? {};
  const {
    projectId: scopeProjectId,
    sessionId: scopeSessionId,
  } = useMobileScope();
  const projectId = params.projectId ?? scopeProjectId;
  const sessionId = params.sessionId ?? scopeSessionId;
  const [turns, setTurns] = useState<readonly PromptPreviewTurn[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  /** 展开中的轮 id（屏级受控，见文件头注释）。 */
  const [openTurnIds, setOpenTurnIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** 展开中的工具组卡 id（同上）。 */
  const [openGroupIds, setOpenGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleId = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
      id: string,
    ) => {
      setter(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [],
  );

  const toggleTurn = useCallback(
    (turnId: string) => toggleId(setOpenTurnIds, turnId),
    [toggleId],
  );
  const toggleGroup = useCallback(
    (groupId: string) => toggleId(setOpenGroupIds, groupId),
    [toggleId],
  );

  const load = useCallback(async () => {
    if (projectId == null || sessionId == null) {
      setError('请先选择项目与会话');
      setTurns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    // 换了会话，旧会话的展开态没有意义：跟随数据一起清。
    // ⚠️ 已经空的时候**返回原引用**：屏级 runtime 若不是稳定引用，load 会随每次
    // 重渲染换新的 useCallback → useEffect 重跑；这里若无条件塞新 Set，
    // setState 永远「有变化」→ 重渲染 → 再跑 effect，死循环到 Maximum update depth。
    setOpenTurnIds(prev => (prev.size === 0 ? prev : new Set()));
    setOpenGroupIds(prev => (prev.size === 0 ? prev : new Set()));
    try {
      const list = await buildRealPromptPreviewTurns(runtime, {
        projectId,
        sessionId,
      });
      setTurns(list);
    } catch (err) {
      const message =
        err instanceof AgentRunError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      setError(message);
      setTurns([]);
    } finally {
      setLoading(false);
    }
  }, [runtime, projectId, sessionId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : error ? (
        <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
      ) : (
        <FlatList
          data={turns}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.content}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <Text style={{color: tokens.textSecondary}}>（空提示词）</Text>
          }
          ListFooterComponent={
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              在聊天工作区调整纳入规则可改变预览内容。点轮卡头部就地展开，点子卡进入全屏阅读。
            </Text>
          }
          renderItem={({item}) => (
            <PromptTurnRow
              turn={item}
              openTurnIds={openTurnIds}
              openGroupIds={openGroupIds}
              onToggleTurn={toggleTurn}
              onToggleGroup={toggleGroup}
            />
          )}
        />
      )}
    </View>
  );
}

/** 一轮的渲染：统一轮卡 + 展开区的有序卡片流（工具组卡 / 叶子卡）。 */
function PromptTurnRow({
  turn,
  openTurnIds,
  openGroupIds,
  onToggleTurn,
  onToggleGroup,
}: {
  turn: PromptPreviewTurn;
  openTurnIds: ReadonlySet<string>;
  openGroupIds: ReadonlySet<string>;
  onToggleTurn: (turnId: string) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  return (
    // key 归 FlatList 的 keyExtractor，这里不加。
    <PromptTurnCard turn={turn} expanded={openTurnIds.has(turn.id)} onToggle={onToggleTurn}>
      {turn.cards.map(card => {
        if (card.type === 'toolGroup') {
          return (
            <PromptToolGroupCard
              key={card.id}
              card={card}
              turnId={turn.id}
              expanded={openGroupIds.has(card.id)}
              onToggle={onToggleGroup}
            />
          );
        }
        if (card.type === 'workplace') {
          return (
            <PromptWorkplaceCard
              key={card.id}
              card={card}
              turnId={turn.id}
              // 文件级展开态共用屏级集合：key=`${card.id}:${path}`，组件内逐行 O(1) 查。
              openGroupIds={openGroupIds}
              onToggleFile={path => onToggleGroup(`${card.id}:${path}`)}
            />
          );
        }
        return <PromptTurnLeafCard key={card.id} card={card} turnId={turn.id} />;
      })}
    </PromptTurnCard>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  error: {padding: 16, fontSize: 14},
  list: {flex: 1},
  content: {padding: 16, paddingBottom: 32},
  hint: {marginTop: 8, fontSize: 13},
});