/**
 * 聊天记录查询页（mobile）。
 *
 * 直接调用 core 的 `runtime.messages.searchMessages`，与 desktop 共用同一份后端
 * 逻辑。结果列表自渲染精简卡片（不复用 chat/MessageList，因为 MessageList 没有
 * onEndReached 透传、且绑定 streaming 语境，搜索结果场景错配）。
 *
 * 搜索始终包含隐藏消息——hidden 的卡片整体降透明度，与「已隐藏」语义一致。
 *
 * 布局只有一排搜索栏（关键词输入框 + 搜索按钮），下方 FlatList 占满剩余屏幕。
 * 返回由导航 header 的 showBack 处理，组件内不再单独放返回按钮。
 *
 * 点击卡片可以展开/收起完整文本内容，避免长消息被摘要截断后无法阅读。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import type {ChatMessage} from '@novel-master/core/chat';
import {FormTextInput} from '../../components/form/FormTextInput';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import type {ThemeTokens} from '../../theme/tokens';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'ChatHistorySearch'>;

const SEARCH_LIMIT = 50;

/**
 * 把消息里的 TextBlock 拼成单行摘要（忽略 tool_use / thinking 等非对话块）。
 * 跟 core 的 `messageMatchesKeyword` 扫描范围保持一致，避免「命中了但卡片看不到」。
 *
 * 摘要只用于收起态预览；展开后用 `extractFullText` 拿完整文本。
 */
function extractMessageSummary(message: ChatMessage, max = 200): string {
  const full = extractFullText(message);
  if (full.length <= max) {
    return full || '（无文本内容）';
  }
  return full.slice(0, max) + '…';
}

/** 拼接消息所有 TextBlock 的完整文本（不截断）。 */
function extractFullText(message: ChatMessage): string {
  const parts: string[] = [];
  for (const block of message.content.blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/** 角色标签：user/assistant 直出，其他角色归一为「系统」。 */
function roleLabel(role: string): string {
  if (role === 'user') {
    return '我';
  }
  if (role === 'assistant') {
    return 'AI';
  }
  return '系统';
}

export function ChatHistorySearchScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const {sessionId} = route.params;

  const [keyword, setKeyword] = useState('');

  const [results, setResults] = useState<readonly ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** 是否已经发起过一次查询，用于区分初始空态与「未命中」。 */
  const [hasSearched, setHasSearched] = useState(false);
  /** 上一批结果是否可能还有更早的（命中 LIMIT 视为可能还有）。 */
  const [hasMore, setHasMore] = useState(false);

  /** 当前结果集中最小的 seq，作为「加载更早」的 beforeSeq 游标。 */
  const minSeq = useMemo(() => {
    if (results.length === 0) {
      return undefined;
    }
    return results.reduce((acc, m) => Math.min(acc, m.seq), Number.POSITIVE_INFINITY);
  }, [results]);

  const runQuery = useCallback(
    async (opts?: {beforeSeq?: number; append?: boolean}) => {
      const append = opts?.append ?? false;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setResults([]);
      }
      setError(undefined);

      const trimmed = keyword.trim();
      try {
        const batch = await runtime.messages.searchMessages(sessionId, {
          keyword: trimmed.length > 0 ? trimmed : undefined,
          limit: SEARCH_LIMIT,
          beforeSeq: opts?.beforeSeq,
        });
        setHasMore(batch.length >= SEARCH_LIMIT);
        if (append) {
          setResults(prev => [...prev, ...batch]);
        } else {
          setResults(batch);
        }
        setHasSearched(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        setError(message);
        setHasSearched(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [runtime, sessionId, keyword],
  );

  const onSubmitSearch = useCallback(() => {
    runQuery().catch(() => undefined);
  }, [runQuery]);

  const onEndReached = useCallback(() => {
    if (!hasMore || loading || loadingMore || minSeq == null) {
      return;
    }
    runQuery({beforeSeq: minSeq, append: true}).catch(() => undefined);
  }, [hasMore, loading, loadingMore, minSeq, runQuery]);

  const showEmpty = hasSearched && !loading && results.length === 0;

  const renderItem = useCallback(
    ({item}: {item: ChatMessage}) => (
      <MessageResultCard message={item} tokens={tokens} />
    ),
    [tokens],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const ListFooterComponent = loadingMore ? (
    <Text style={[styles.hint, {color: tokens.textSecondary}]}>
      正在加载更早的记录…
    </Text>
  ) : null;

  const ListEmptyComponent = showEmpty ? (
    <View style={styles.emptyWrap}>
      <Text
        style={[styles.empty, {color: tokens.textSecondary}]}
        testID="chat-history-search-empty">
        未找到匹配的聊天记录
      </Text>
    </View>
  ) : null;

  // 用 KeyboardAvoidingView 包裹根部，让软键盘弹起时收缩可视窗口，
  // 避免搜索框 / 结果列表被键盘盖住（Android 默认 resize 行为不可靠）。
  return (
    <KeyboardAvoidingView
      style={[styles.root, {backgroundColor: tokens.background}]}
      behavior="padding">
      {/* 顶部：搜索栏（关键词输入框 + 搜索按钮），固定区域，不参与滚动。 */}
      <View
        style={[
          styles.header,
          {borderBottomColor: tokens.borderLight},
        ]}>
        <View style={styles.searchRow}>
          <FormTextInput
            testID="chat-history-search-keyword"
            tokens={tokens}
            value={keyword}
            onChangeText={setKeyword}
            placeholder="输入关键词，留空列出全部"
            accessibilityLabel="搜索关键词输入框"
            style={styles.keywordInput}
          />
          <Pressable
            testID="chat-history-search-submit"
            onPress={onSubmitSearch}
            disabled={loading}
            style={[
              styles.submitBtn,
              {backgroundColor: tokens.primary, opacity: loading ? 0.6 : 1},
            ]}
            accessibilityLabel="查询聊天记录">
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>搜索</Text>
            )}
          </Pressable>
        </View>

        {/* 错误信息紧凑显示在搜索栏下方 */}
        {error != null ? (
          <Text style={[styles.error, {color: tokens.danger}]} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
      </View>

      {/* 结果列表：FlatList 占满剩余屏幕，同时承担分页加载。 */}
      <FlatList
        style={styles.resultList}
        data={results}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={
          results.length === 0
            ? styles.resultContentEmpty
            : styles.resultContent
        }
      />
    </KeyboardAvoidingView>
  );
}

/** 单条搜索结果卡片：角色标签 + seq + 摘要；hidden 时整体降透明度。
 *  点击卡片切换展开/收起——展开后显示完整文本（不限行数）。 */
function MessageResultCard({
  message,
  tokens,
}: {
  message: ChatMessage;
  tokens: ThemeTokens;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = extractMessageSummary(message);
  const fullText = extractFullText(message);
  const canExpand = fullText.length > 200 || fullText.includes('\n');

  return (
    <Pressable
      testID="chat-history-search-result-card"
      onPress={() => canExpand && setExpanded(prev => !prev)}
      style={[
        styles.resultCard,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.borderLight,
          opacity: message.hidden ? 0.55 : 1,
        },
      ]}>
      <View style={styles.resultHead}>
        <Text style={[styles.roleTag, {color: tokens.primary}]}>
          {roleLabel(message.role)}
        </Text>
        {message.hidden ? (
          <Text style={[styles.hiddenTag, {color: tokens.textTertiary}]}>
            已隐藏
          </Text>
        ) : null}
        <Text style={[styles.seq, {color: tokens.textTertiary}]}>
          #{message.seq}
        </Text>
      </View>
      <Text
        style={[styles.resultBody, {color: tokens.text}]}
        numberOfLines={expanded ? undefined : 4}>
        {expanded ? fullText || '（无文本内容）' : summary}
      </Text>
      {canExpand ? (
        <Text style={[styles.expandHint, {color: tokens.primary}]}>
          {expanded ? '收起' : '展开全文'}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    padding: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  keywordInput: {flex: 1},
  submitBtn: {
    width: 56,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {color: '#FFFFFF', fontSize: 15, fontWeight: '700'},
  error: {fontSize: 12, paddingHorizontal: 2},
  resultList: {flex: 1},
  resultContent: {padding: 16, gap: 10},
  resultContentEmpty: {flex: 1, padding: 16, gap: 10},
  resultCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  resultHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  roleTag: {fontSize: 13, fontWeight: '700'},
  hiddenTag: {fontSize: 11, fontWeight: '500'},
  seq: {fontSize: 11, marginLeft: 'auto'},
  resultBody: {fontSize: 14, lineHeight: 20},
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24},
  empty: {fontSize: 14, textAlign: 'center'},
  expandHint: {fontSize: 13, fontWeight: '600', paddingTop: 4},
  hint: {fontSize: 12, textAlign: 'center', paddingVertical: 8},
});
