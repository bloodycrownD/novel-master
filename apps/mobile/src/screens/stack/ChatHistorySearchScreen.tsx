/**
 * 聊天记录查询页（mobile）。
 *
 * 直接调用 core 的 `runtime.messages.searchMessages`，与 desktop 共用同一份后端
 * 逻辑。结果列表自渲染精简卡片（不复用 chat/MessageList，因为 MessageList 没有
 * onEndReached 透传、且绑定 streaming 语境，搜索结果场景错配）。
 *
 * 搜索始终包含隐藏消息——hidden 的卡片整体降透明度，与「已隐藏」语义一致。
 *
 * 布局：顶部「搜索栏 + 工具条」两行固定区域，下方 FlatList 占满剩余屏幕。
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
import DateTimePicker from '@react-native-community/datetimepicker';
import type {DateTimePickerEvent} from '@react-native-community/datetimepicker';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {ChatMessage} from '@novel-master/core/chat';
import {FormTextInput} from '../../components/form/FormTextInput';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import type {ThemeTokens} from '../../theme/tokens';
import type {RootStackParamList} from '../../navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'ChatHistorySearch'>;

const SEARCH_LIMIT = 50;

/** 搜索模式分段。 */
type SearchMode = 'literal' | 'regex';

/** 哪一个日期选择器当前展开（一次只展开一个，避免两个 picker 重叠）。 */
type DateField = 'from' | 'to';

/**
 * 把消息里的 TextBlock 拼成单行摘要（忽略 tool_use / thinking 等非对话块）。
 * 跟 core 的 `messageMatchesKeyword` 扫描范围保持一致，避免「命中了但卡片看不到」。
 */
function extractMessageSummary(message: ChatMessage, max = 200): string {
  const parts: string[] = [];
  for (const block of message.content.blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  const full = parts.join('\n').trim();
  if (full.length <= max) {
    return full || '（无文本内容）';
  }
  return full.slice(0, max) + '…';
}

/** 把 Date 格式化成 YYYY-MM-DD 展示给用户（本地时区）。 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 把 Date 折算成 MM-DD 简写，给日期按钮文字用，避免太长挤占工具条。 */
function formatDateShort(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

/**
 * 根据当前已选的 from/to 计算日期按钮上显示的文字。
 * 没选就显示「日期」，只选一端就显示「从 xx」「至 xx」，两端都选就显示区间。
 */
function dateRangeLabel(from: Date | undefined, to: Date | undefined): string {
  if (from != null && to != null) {
    return `${formatDateShort(from)} ~ ${formatDateShort(to)}`;
  }
  if (from != null) {
    return `从 ${formatDateShort(from)}`;
  }
  if (to != null) {
    return `至 ${formatDateShort(to)}`;
  }
  return '日期';
}

/** 把 Date 折算成搜索边界 ms：start=false 取当天 00:00:00.000，true 取 23:59:59.999。 */
function toDateBound(date: Date, endOfDay: boolean): number {
  const copy = new Date(date);
  if (endOfDay) {
    copy.setHours(23, 59, 59, 999);
  } else {
    copy.setHours(0, 0, 0, 0);
  }
  return copy.getTime();
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
  const navigation = useNavigation();
  const route = useRoute<ScreenRoute>();
  const {sessionId} = route.params;

  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<SearchMode>('literal');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  /** 当前展开的日期选择器字段，null 表示收起。 */
  const [openPicker, setOpenPicker] = useState<DateField | null>(null);

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
          mode,
          caseSensitive,
          fromMs: fromDate != null ? toDateBound(fromDate, false) : undefined,
          toMs: toDate != null ? toDateBound(toDate, true) : undefined,
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
    [runtime, sessionId, keyword, mode, caseSensitive, fromDate, toDate],
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

  const onDateChange = useCallback(
    (field: DateField, event: DateTimePickerEvent, date?: Date) => {
      // Android 上「取消」会带 type='dismissed'，直接收起 picker 不改值。
      if (event.type !== 'set' || date == null) {
        setOpenPicker(null);
        return;
      }
      if (field === 'from') {
        setFromDate(date);
        // 选完 from 之后自动接力弹 to，让用户一次性把范围选完。
        setOpenPicker('to');
      } else {
        setToDate(date);
        setOpenPicker(null);
      }
    },
    [],
  );

  /**
   * 点日期按钮的策略：从头开始重新走一遍选择流程。
   * 如果两端都还没选，或者已经选完，都先弹 from；选完 from 自动弹 to。
   */
  const onPressDate = useCallback(() => {
    setOpenPicker('from');
  }, []);

  const onBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const showEmpty = hasSearched && !loading && results.length === 0;

  const dateActive = fromDate != null || toDate != null;
  const dateLabel = dateRangeLabel(fromDate, toDate);

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

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {/* 顶部：搜索栏 + 工具条，固定区域，不参与滚动。 */}
      <View
        style={[
          styles.header,
          {borderBottomColor: tokens.borderLight},
        ]}>
        {/* 第 1 行：关键词输入框 + 搜索按钮 */}
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
              {backgroundColor: tokens.primary, opacity: loading ? 0.7 : 1},
            ]}
            accessibilityLabel="查询聊天记录">
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>搜索</Text>
            )}
          </Pressable>
        </View>

        {/* 第 2 行：工具条——精准/正则 + 大小写 + 日期 + 返回 */}
        <View style={styles.toolbar}>
          {/* 精准/正则 pill 切换 */}
          <Pressable
            testID="chat-history-search-mode-literal"
            onPress={() => setMode('literal')}
            style={[
              styles.pill,
              {
                backgroundColor:
                  mode === 'literal' ? tokens.primary : tokens.surface,
                borderColor:
                  mode === 'literal' ? tokens.primary : tokens.borderLight,
              },
            ]}>
            <Text
              style={[
                styles.pillText,
                {color: mode === 'literal' ? '#FFFFFF' : tokens.textSecondary},
              ]}>
              精准
            </Text>
          </Pressable>
          <Pressable
            testID="chat-history-search-mode-regex"
            onPress={() => setMode('regex')}
            style={[
              styles.pill,
              {
                backgroundColor:
                  mode === 'regex' ? tokens.primary : tokens.surface,
                borderColor: mode === 'regex' ? tokens.primary : tokens.borderLight,
              },
            ]}>
            <Text
              style={[
                styles.pillText,
                {color: mode === 'regex' ? '#FFFFFF' : tokens.textSecondary},
              ]}>
              正则
            </Text>
          </Pressable>

          {/* Aa 大小写 toggle */}
          <Pressable
            testID="chat-history-search-case-sensitive"
            onPress={() => setCaseSensitive(v => !v)}
            style={[
              styles.square,
              {
                backgroundColor: caseSensitive ? tokens.primary : tokens.surface,
                borderColor: caseSensitive ? tokens.primary : tokens.borderLight,
              },
            ]}>
            <Text
              style={[
                styles.squareText,
                {color: caseSensitive ? '#FFFFFF' : tokens.textSecondary},
              ]}>
              Aa
            </Text>
          </Pressable>

          {/* 日期按钮：紧凑显示当前日期范围，点击重新选 */}
          <Pressable
            testID="chat-history-search-date"
            onPress={onPressDate}
            style={[
              styles.pill,
              {
                backgroundColor: dateActive
                  ? tokens.surfaceElevated
                  : tokens.surface,
                borderColor: dateActive ? tokens.primary : tokens.borderLight,
              },
            ]}>
            <Text
              style={[
                styles.pillText,
                {color: dateActive ? tokens.primary : tokens.textSecondary},
              ]}>
              {dateLabel}
            </Text>
          </Pressable>

          {/* 返回按钮推到最右，作为测试钩子 + 备用返回入口 */}
          <Pressable
            testID="chat-history-search-back"
            onPress={onBack}
            accessibilityLabel="返回"
            style={styles.backBtn}>
            <Text style={[styles.backText, {color: tokens.textSecondary}]}>
              ←
            </Text>
          </Pressable>
        </View>

        {/* 错误信息紧凑显示在工具条下方 */}
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
        contentContainerStyle={styles.resultContent}
      />

      {openPicker === 'from' ? (
        <DateTimePicker
          testID="chat-history-search-from-picker"
          mode="date"
          display="default"
          value={fromDate ?? new Date()}
          onChange={(e, d) => onDateChange('from', e, d)}
        />
      ) : null}
      {openPicker === 'to' ? (
        <DateTimePicker
          testID="chat-history-search-to-picker"
          mode="date"
          display="default"
          value={toDate ?? new Date()}
          onChange={(e, d) => onDateChange('to', e, d)}
        />
      ) : null}
    </View>
  );
}

/** 单条搜索结果卡片：角色标签 + seq + 摘要；hidden 时整体降透明度。 */
function MessageResultCard({
  message,
  tokens,
}: {
  message: ChatMessage;
  tokens: ThemeTokens;
}) {
  return (
    <View
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
        numberOfLines={4}>
        {extractMessageSummary(message)}
      </Text>
    </View>
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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {fontSize: 13, fontWeight: '600'},
  square: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  squareText: {fontSize: 14, fontWeight: '700'},
  backBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backText: {fontSize: 18},
  error: {fontSize: 12, paddingHorizontal: 2},
  resultList: {flex: 1},
  resultContent: {padding: 16, gap: 10},
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
  hint: {fontSize: 12, textAlign: 'center', paddingVertical: 8},
});
