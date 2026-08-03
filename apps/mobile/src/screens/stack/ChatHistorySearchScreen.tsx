/**
 * 聊天记录查询页（mobile）。
 *
 * 直接调用 core 的 `runtime.messages.searchMessages`，与 desktop 共用同一份后端
 * 逻辑。结果列表自渲染精简卡片（不复用 chat/MessageList，因为 MessageList 没有
 * onEndReached 透传、且绑定 streaming 语境，搜索结果场景错配）。
 *
 * 搜索始终包含隐藏消息——hidden 的卡片整体降透明度，与「已隐藏」语义一致。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
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
      } else {
        setToDate(date);
      }
      setOpenPicker(null);
    },
    [],
  );

  const onBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const showEmpty = hasSearched && !loading && results.length === 0;

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ScrollView
        style={styles.conditionScroll}
        contentContainerStyle={styles.conditionContent}
        keyboardShouldPersistTaps="handled">
        <FormTextInput
          testID="chat-history-search-keyword"
          tokens={tokens}
          value={keyword}
          onChangeText={setKeyword}
          placeholder="输入关键词，留空列出全部"
          accessibilityLabel="搜索关键词输入框"
        />

        <View style={styles.controlRow}>
          <SegmentedControl<SearchMode>
            tokens={tokens}
            value={mode}
            onChange={value => setMode(value)}
            options={[
              {value: 'literal', label: '精准', testID: 'chat-history-search-mode-literal'},
              {value: 'regex', label: '正则', testID: 'chat-history-search-mode-regex'},
            ]}
          />
        </View>

        <View
          style={[
            styles.switchCard,
            {backgroundColor: tokens.surface, borderColor: tokens.borderLight},
          ]}>
          <FormSwitchRow
            label="区分大小写"
            description="关闭时精准匹配忽略大小写、正则自动加 i flag"
            tokens={tokens}
            value={caseSensitive}
            onValueChange={setCaseSensitive}
            testID="chat-history-search-case-sensitive"
          />
        </View>

        <View style={styles.dateRow}>
          <DateChip
            testID="chat-history-search-from"
            label="起始日期"
            value={fromDate != null ? formatDate(fromDate) : '不限'}
            onPress={() => setOpenPicker('from')}
            tokens={tokens}
          />
          <DateChip
            testID="chat-history-search-to"
            label="结束日期"
            value={toDate != null ? formatDate(toDate) : '不限'}
            onPress={() => setOpenPicker('to')}
            tokens={tokens}
          />
        </View>

        <Pressable
          testID="chat-history-search-submit"
          onPress={onSubmitSearch}
          disabled={loading}
          style={[
            styles.submitBtn,
            {
              backgroundColor: tokens.primary,
              opacity: loading ? 0.6 : 1,
            },
          ]}
          accessibilityLabel="查询聊天记录">
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>查询</Text>
          )}
        </Pressable>

        {error != null ? (
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* 结果列表：自渲染 FlatList，不复用 chat/MessageList。 */}
      <View style={[styles.resultSection, {backgroundColor: tokens.background}]}>
        {loadingMore ? (
          <ActivityIndicator style={styles.loadingMore} color={tokens.primary} />
        ) : null}
        {results.length > 0 ? (
          <ScrollView
            style={styles.resultScroll}
            contentContainerStyle={styles.resultContent}
            onScroll={({nativeEvent}) => {
              const {layoutMeasurement, contentOffset, contentSize} = nativeEvent;
              const distanceFromEnd =
                contentSize.height - layoutMeasurement.height - contentOffset.y;
              if (distanceFromEnd < 80) {
                onEndReached();
              }
            }}
            scrollEventThrottle={32}>
            {results.map(message => (
              <MessageResultCard
                key={message.id}
                message={message}
                tokens={tokens}
              />
            ))}
            {loadingMore ? (
              <Text style={[styles.hint, {color: tokens.textSecondary}]}>
                正在加载更早的记录…
              </Text>
            ) : null}
          </ScrollView>
        ) : showEmpty ? (
          <View style={styles.emptyWrap}>
            <Text
              style={[styles.empty, {color: tokens.textSecondary}]}
              testID="chat-history-search-empty">
              未找到匹配的聊天记录
            </Text>
          </View>
        ) : null}
      </View>

      {/* 返回按钮：测试用 testID 钩子；运行时也方便单手返回。 */}
      <Pressable
        testID="chat-history-search-back"
        onPress={onBack}
        accessibilityLabel="返回"
        style={[styles.backBtn, {backgroundColor: tokens.surface, borderColor: tokens.borderLight}]}>
        <Text style={[styles.backText, {color: tokens.text}]}>返回</Text>
      </Pressable>

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

/** 日期选择触发按钮：label 在上、当前值在下，整体像一张窄卡片。 */
function DateChip({
  label,
  value,
  onPress,
  tokens,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  tokens: typeof import('../../theme/tokens').lightTheme;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.dateChip,
        {backgroundColor: tokens.surface, borderColor: tokens.borderLight},
      ]}
      accessibilityLabel={label}>
      <Text style={[styles.dateChipLabel, {color: tokens.textSecondary}]}>
        {label}
      </Text>
      <Text style={[styles.dateChipValue, {color: tokens.text}]}>{value}</Text>
    </Pressable>
  );
}

/** 单条搜索结果卡片：角色标签 + seq + 摘要；hidden 时整体降透明度。 */
function MessageResultCard({
  message,
  tokens,
}: {
  message: ChatMessage;
  tokens: typeof import('../../theme/tokens').lightTheme;
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
  conditionScroll: {flex: 0, maxHeight: 380},
  conditionContent: {padding: 16, gap: 12},
  controlRow: {marginTop: 4},
  switchCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateRow: {flexDirection: 'row', gap: 12},
  dateChip: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  dateChipLabel: {fontSize: 12, fontWeight: '500'},
  dateChipValue: {fontSize: 15, fontWeight: '600'},
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {color: '#FFFFFF', fontSize: 16, fontWeight: '700'},
  error: {fontSize: 13, paddingHorizontal: 4},
  resultSection: {flex: 1},
  resultScroll: {flex: 1},
  resultContent: {padding: 16, paddingTop: 8, gap: 10},
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
  loadingMore: {paddingVertical: 8},
  hint: {fontSize: 12, textAlign: 'center', paddingVertical: 8},
  backBtn: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 3,
  },
  backText: {fontSize: 14, fontWeight: '600'},
});
