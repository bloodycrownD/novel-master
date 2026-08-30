/**
 * 聊天记录查询页（mobile）。
 *
 * 直接调用 core 的 `runtime.messages.searchMessages`，与 desktop 共用同一份后端
 * 逻辑。结果列表自渲染精简卡片（不复用 chat/MessageList，因为 MessageList 没有
 * onEndReached 透传、且绑定 streaming 语境，搜索结果场景错配）。
 *
 * 搜索支持关键词（大小写不敏感，由 core 统一处理）、seq 编号区间
 * （fromSeq/toSeq 闭区间，可只填一端）与向上翻页，三者可自由组合。
 * 搜索始终包含隐藏消息——hidden 的卡片整体降透明度，与「已隐藏」语义一致。
 *
 * 布局搜索栏（关键词 + 搜索按钮）下方一排编号区间输入，再下方 FlatList 占满剩余屏幕。
 * 返回由导航 header 的 showBack 处理，组件内不再单独放返回按钮。
 *
 * 点击卡片可以展开/收起完整文本内容，避免长消息被摘要截断后无法阅读。
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import type {ChatMessage} from '@novel-master/core/chat';
import {FormTextInput} from '@/components/form/FormTextInput';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
import type {RootStackParamList} from '@/navigation/types';

type ScreenRoute = RouteProp<RootStackParamList, 'ChatHistorySearch'>;

const SEARCH_LIMIT = 50;

/** 归一编号输入：空串 / 非数字统一归一为 undefined（该侧不设限）。 */
function normalizeSeqInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

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

/** 从当前筛选输入派生收起态摘要（如 `关键词 "xx" · #10–50`；无筛选时给占位文案）。 */
function deriveFilterSummary(
  keyword: string,
  fromSeqText: string,
  toSeqText: string,
): string {
  const parts: string[] = [];
  const trimmedKeyword = keyword.trim();
  if (trimmedKeyword.length > 0) {
    parts.push(`关键词 "${trimmedKeyword}"`);
  }
  const fromSeq = normalizeSeqInput(fromSeqText);
  const toSeq = normalizeSeqInput(toSeqText);
  if (fromSeq != null || toSeq != null) {
    parts.push(`#${fromSeq ?? '起'}–${toSeq ?? '止'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '未设置筛选条件';
}

export function ChatHistorySearchScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const route = useRoute<ScreenRoute>();
  const {sessionId} = route.params;

  const [keyword, setKeyword] = useState('');
  const [fromSeqText, setFromSeqText] = useState('');
  const [toSeqText, setToSeqText] = useState('');

  const [results, setResults] = useState<readonly ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** 筛选表单折叠卡片是否展开（默认展开；查询成功且有结果时自动收起）。 */
  const [formExpanded, setFormExpanded] = useState(true);
  /** 是否已经发起过一次查询，用于区分初始空态与「未命中」。 */
  const [hasSearched, setHasSearched] = useState(false);
  /** 上一批结果是否可能还有更早的（命中 LIMIT 视为可能还有）。 */
  const [hasMore, setHasMore] = useState(false);

  // Android 裁切窗口：与 ScreenFormLayout 同款——用 marginBottom 收缩键盘高度，
  // 让搜索栏 + 结果列表跟铉缩到键盘以上。iOS 走 KeyboardAvoidingView 的 padding。
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const clipStyle = useAnimatedStyle(() => {
    const kb = -keyboardHeightSV.value;
    return {marginBottom: kb};
  }, [keyboardHeightSV]);

  /** 当前结果集中最小的 seq，作为「加载更早」的 beforeSeq 游标。 */
  const minSeq = useMemo(() => {
    if (results.length === 0) {
      return undefined;
    }
    return results.reduce(
      (acc, m) => Math.min(acc, m.seq),
      Number.POSITIVE_INFINITY,
    );
  }, [results]);

  const runQuery = useCallback(
    async (opts?: {beforeSeq?: number; append?: boolean}) => {
      const fromSeq = normalizeSeqInput(fromSeqText);
      const toSeq = normalizeSeqInput(toSeqText);
      // 倒挂区间不发请求，给提示（PRD 验收 #6）。
      if (fromSeq != null && toSeq != null && fromSeq > toSeq) {
        setError('编号区间无效：起始编号不能大于截止编号');
        return;
      }
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
          fromSeq,
          toSeq,
        });
        setHasMore(batch.length >= SEARCH_LIMIT);
        if (append) {
          setResults(prev => [...prev, ...batch]);
        } else {
          setResults(batch);
          // 首次查询命中才收起表单：空结果算「未命中」不算成功，倒挂与异常分支不会走到这里。
          if (batch.length > 0) {
            setFormExpanded(false);
            Keyboard.dismiss();
          }
        }
        setHasSearched(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setHasSearched(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [runtime, sessionId, keyword, fromSeqText, toSeqText],
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

  // 收起态摘要直接从筛选项 state 派生，不另存一份；输入值在收起卸载表单时不丢。
  const filterSummary = deriveFilterSummary(keyword, fromSeqText, toSeqText);

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
        testID="chat-history-search-empty"
      >
        未找到匹配的聊天记录
      </Text>
    </View>
  ) : null;

  // 搜索栏 + 结果列表主体：抽出来供 iOS / Android 两个分支复用。
  const body = (
    <>
      {/* 顶部：筛选表单折叠卡片（默认展开；成功命中后自动收起，收起态显示摘要）。 */}
      <View style={[styles.header, {borderBottomColor: tokens.borderLight}]}>
        <View
          style={[
            styles.formCard,
            {
              backgroundColor: tokens.surfaceElevated,
              borderColor: tokens.borderLight,
            },
          ]}
        >
          <Pressable
            testID="chat-history-search-form-toggle"
            style={styles.formCardHeader}
            onPress={() => setFormExpanded(v => !v)}
            accessibilityRole="button"
            accessibilityState={{expanded: formExpanded}}
            accessibilityLabel="筛选条件"
          >
            <View style={styles.formCardHeaderText}>
              <Text style={[styles.formCardTitle, {color: tokens.text}]}>
                筛选条件
              </Text>
              {!formExpanded ? (
                <Text
                  style={[
                    styles.formCardSummary,
                    {color: tokens.textSecondary},
                  ]}
                  numberOfLines={1}
                >
                  {filterSummary}
                </Text>
              ) : null}
            </View>
            <Text
              style={[styles.formCardChevron, {color: tokens.textTertiary}]}
            >
              {formExpanded ? '▼' : '▶'}
            </Text>
          </Pressable>
          {formExpanded ? (
            <View style={styles.formCardBody}>
              <View style={styles.sectionLabelRow}>
                <Text
                  style={[styles.sectionLabel, {color: tokens.textSecondary}]}
                >
                  关键词
                </Text>
              </View>
              <View style={styles.searchRow}>
                <FormTextInput
                  testID="chat-history-search-keyword"
                  tokens={tokens}
                  value={keyword}
                  onChangeText={setKeyword}
                  placeholder="关键词"
                  accessibilityLabel="搜索关键词输入框"
                  style={styles.keywordInput}
                />
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
                  accessibilityLabel="查询聊天记录"
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitText}>搜索</Text>
                  )}
                </Pressable>
              </View>

              {/* 编号区间节：两个数字输入并排，均可留空表示该侧不设限。 */}
              <View style={styles.sectionLabelRow}>
                <Text
                  style={[styles.sectionLabel, {color: tokens.textSecondary}]}
                >
                  编号区间
                </Text>
                <Text
                  style={[styles.sectionHint, {color: tokens.textTertiary}]}
                >
                  留空不限
                </Text>
              </View>
              <View style={styles.seqRow}>
                <FormTextInput
                  testID="chat-history-search-from-seq"
                  tokens={tokens}
                  value={fromSeqText}
                  onChangeText={t => setFromSeqText(t.replace(/[^0-9]/g, ''))}
                  placeholder="从 #"
                  keyboardType="numeric"
                  accessibilityLabel="起始编号输入框"
                  style={styles.seqInput}
                />
                <Text style={[styles.seqDash, {color: tokens.textTertiary}]}>
                  –
                </Text>
                <FormTextInput
                  testID="chat-history-search-to-seq"
                  tokens={tokens}
                  value={toSeqText}
                  onChangeText={t => setToSeqText(t.replace(/[^0-9]/g, ''))}
                  placeholder="到 #"
                  keyboardType="numeric"
                  accessibilityLabel="截止编号输入框"
                  style={styles.seqInput}
                />
              </View>
            </View>
          ) : null}
        </View>
        {/* 错误恒显在折叠卡片外：首次查询成功后表单自动收起，若翻页 append
            失败，收起态下错误仍可见，不会藏在卡片里丢失反馈。 */}
        {error != null ? (
          <Text
            style={[styles.error, {color: tokens.danger}]}
            numberOfLines={2}
          >
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
    </>
  );

  // iOS 走 KeyboardAvoidingView 的 padding；Android 上 react-native-keyboard-controller
  // 的 KeyboardAvoidingView behavior={undefined} 等于啥也不干，改用 Animated.View 的
  // marginBottom 收缩裁切窗口（与 ScreenFormLayout 同款范式 A）。
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView
      style={[styles.root, {backgroundColor: tokens.background}]}
      behavior="padding"
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    <Animated.View
      style={[styles.root, {backgroundColor: tokens.background}, clipStyle]}
    >
      {body}
    </Animated.View>
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
      ]}
    >
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
        numberOfLines={expanded ? undefined : 4}
      >
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
  seqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seqInput: {flex: 1},
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
  // 折叠卡片容器：样式值对齐 FormSectionCard（圆角 16 + hairline 描边 + shadow/elevation 2）。
  formCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  // 卡片头：结构对齐 PromptPreviewSegmentCard（Pressable + 摘要 + ▶/▼ 文字 chevron）。
  formCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formCardHeaderText: {flex: 1, minWidth: 0},
  formCardTitle: {fontSize: 15, fontWeight: '600'},
  formCardSummary: {fontSize: 12, lineHeight: 17, marginTop: 2},
  formCardChevron: {fontSize: 10, paddingTop: 4},
  formCardBody: {gap: 8, marginTop: 10},
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sectionLabel: {fontSize: 13, fontWeight: '600'},
  sectionHint: {fontSize: 12},
  seqDash: {fontSize: 14, paddingHorizontal: 2},
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  empty: {fontSize: 14, textAlign: 'center'},
  expandHint: {fontSize: 13, fontWeight: '600', paddingTop: 4},
  hint: {fontSize: 12, textAlign: 'center', paddingVertical: 8},
});
