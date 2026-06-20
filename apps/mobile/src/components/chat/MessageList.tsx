/**
 * Session message list with tool cards, streaming tail, and optional batch select.
 *
 * @deprecated Transcript path uses {@link ChatTranscriptWebView}; retained only when
 * Rollback path when `chatTranscriptEngine` KKV is set to `legacy-rn`.
 */
import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type {MessageMenuAnchor} from './MessageActionMenu';
import { type ChatMessage } from "@novel-master/core/chat";
import type {MessageBatchMode} from './transcript-selectable-role';
import {isTailBatchMode} from './transcript-selectable-role';
import {
  isTranscriptRowSelectable,
  transcriptSelectableRole,
} from './transcript-selectable-role';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {RichContentBody} from '@/components/rich-content/RichContentBody';
import {isRichContentOverLimit} from '@/components/rich-content/rich-content-limits';
import type {ChatListScrollSnapshot} from '@/services/chat-list-scroll-cache';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
import {buildChatListItems, type ChatListItem} from './message-blocks';
import {ThinkingBlockCard} from './ThinkingBlockCard';
import {ToolCallGroupCard} from './ToolCallGroupCard';
import {ToolTurnPhaseBar} from './ToolTurnPhaseBar';

type Props = {
  messages: readonly ChatMessage[];
  streamingText?: string;
  streamingThinking?: string;
  toolInvoking?: boolean;
  agentRunning?: boolean;
  /** When true, user + assistant bubbles use RichContentBody (streaming tail stays plain Text). */
  chatRichTextEnabled?: boolean;
  /** Bumped on app upgrade to remount rich renderers (see app-version-guard). */
  richRenderEpoch?: number;
  batchMode?: MessageBatchMode | null;
  selectedMessageIds?: ReadonlySet<string>;
  /** 范围预览：hide/restore 将影响的消息 id（含不可勾选行）。 */
  affectedMessageIds?: ReadonlySet<string>;
  onToggleMessageSelect?: (messageId: string) => void;
  onMessageLongPress?: (
    message: ChatMessage,
    anchor: MessageMenuAnchor,
  ) => void;
  /** Shown at the top of the timeline (e.g. load older history). */
  listHeaderComponent?: React.ReactElement | null;
  /** Open session VFS file from vfs.read / write / replace tool cards. */
  onOpenToolFile?: (path: string) => void;
  /** Restored scroll position after panel remount (workspace ↔ chat). */
  initialScroll?: ChatListScrollSnapshot | null;
  onScrollSnapshot?: (snap: ChatListScrollSnapshot) => void;
  /**
   * New session with no cache: mark near-bottom for stream follow only (no initial scrollToEnd).
   */
  defaultScrollToBottom?: boolean;
};

/** Within this distance from the bottom we treat the user as "following" the tail. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const SCROLL_TO_END_MIN_INTERVAL_MS = 100;
const SCROLL_SNAPSHOT_THROTTLE_MS = 100;

interface ChatMessageBodyProps {
  body: string;
  tokens: ThemeTokens;
  isUser: boolean;
  richTextEnabled: boolean;
  richRenderEpoch: number;
  messageId: string;
  bodyColor: string;
}

/** Hidden rows use the same palette as normal bubbles, only dimmed (no badge). */
function chatBubbleColors(
  tokens: ThemeTokens,
  isUser: boolean,
): {backgroundColor: string; bodyColor: string} {
  return {
    backgroundColor: isUser ? tokens.primary : tokens.surface,
    bodyColor: isUser ? '#fff' : tokens.text,
  };
}

/** Chat bubble body: plain Text when pref off, else shared rich renderer. */
const ChatMessageBody = React.memo(function ChatMessageBody({
  body,
  tokens,
  isUser,
  richTextEnabled,
  richRenderEpoch,
  messageId,
  bodyColor,
}: ChatMessageBodyProps) {
  const plainColor = bodyColor;
  if (!richTextEnabled || isRichContentOverLimit(body)) {
    return <Text style={{color: plainColor}}>{body}</Text>;
  }
  return (
    <RichContentBody
      content={body}
      tokens={tokens}
      variant={isUser ? 'chat-user' : 'chat-assistant'}
      fallbackTextColor={plainColor}
      renderKey={`${messageId}:${richRenderEpoch}`}
    />
  );
});

export function MessageList({
  messages,
  streamingText,
  streamingThinking,
  toolInvoking = false,
  agentRunning = false,
  chatRichTextEnabled = false,
  richRenderEpoch = 0,
  batchMode = null,
  selectedMessageIds,
  affectedMessageIds,
  onToggleMessageSelect,
  onMessageLongPress,
  listHeaderComponent,
  onOpenToolFile,
  initialScroll = null,
  onScrollSnapshot,
  defaultScrollToBottom = false,
}: Props) {
  const {tokens} = useTheme();
  const listRef = useRef<FlatList<ChatListItem | {kind: 'stream'}>>(null);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const prevMessageCountRef = useRef(0);
  // WHY: default true breaks restore — onContentSizeChange runs before useEffect and scrolls to end.
  const nearBottomRef = useRef(
    initialScroll != null
      ? initialScroll.nearBottom
      : defaultScrollToBottom,
  );
  const scrollOffsetRef = useRef(initialScroll?.offsetY ?? 0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const hasAppliedInitialScrollRef = useRef(false);
  const pendingScrollRestoreRef = useRef(initialScroll != null);
  const lastScrollToEndMsRef = useRef(0);
  const scrollToEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountContentOffsetRef = useRef<{x: number; y: number} | undefined>(
    initialScroll != null &&
      !initialScroll.nearBottom &&
      initialScroll.offsetY > 0
      ? {x: 0, y: initialScroll.offsetY}
      : undefined,
  );
  const items = useMemo(
    () => buildChatListItems(messages, {agentRunning}),
    [messages, agentRunning],
  );

  const currentScrollSnapshot = useCallback(
    (): ChatListScrollSnapshot => ({
      offsetY: scrollOffsetRef.current,
      nearBottom: nearBottomRef.current,
    }),
    [],
  );

  const emitScrollSnapshot = useCallback(() => {
    onScrollSnapshot?.(currentScrollSnapshot());
  }, [onScrollSnapshot, currentScrollSnapshot]);

  const scheduleSnapshotEmit = useCallback(() => {
    if (!onScrollSnapshot) {
      return;
    }
    if (snapshotThrottleRef.current != null) {
      return;
    }
    snapshotThrottleRef.current = setTimeout(() => {
      snapshotThrottleRef.current = null;
      emitScrollSnapshot();
    }, SCROLL_SNAPSHOT_THROTTLE_MS);
  }, [onScrollSnapshot, emitScrollSnapshot]);

  const applyPendingScrollRestore = useCallback(
    (contentHeight?: number) => {
      if (!pendingScrollRestoreRef.current) {
        return;
      }
      if (contentHeight != null) {
        contentHeightRef.current = contentHeight;
      }
      // WHY: scrollToOffset is a no-op until FlatList has laid out content.
      if (contentHeightRef.current <= 0) {
        return;
      }
      if (initialScroll?.nearBottom) {
        listRef.current?.scrollToEnd({animated: false});
        pendingScrollRestoreRef.current = false;
        return;
      }
      if (initialScroll) {
        listRef.current?.scrollToOffset({
          offset: initialScroll.offsetY,
          animated: false,
        });
        pendingScrollRestoreRef.current = false;
      }
    },
    [initialScroll],
  );

  const scheduleScrollToEnd = useCallback(() => {
    if (pendingScrollRestoreRef.current) {
      return;
    }
    if (!nearBottomRef.current) {
      return;
    }
    if (scrollToEndTimerRef.current != null) {
      return;
    }
    const now = Date.now();
    const delay = Math.max(
      0,
      SCROLL_TO_END_MIN_INTERVAL_MS - (now - lastScrollToEndMsRef.current),
    );
    scrollToEndTimerRef.current = setTimeout(() => {
      scrollToEndTimerRef.current = null;
      lastScrollToEndMsRef.current = Date.now();
      requestAnimationFrame(() => {
        if (nearBottomRef.current) {
          listRef.current?.scrollToEnd({animated: false});
        }
      });
    }, delay);
  }, []);

  const syncNearBottomFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      scrollOffsetRef.current = contentOffset.y;
      contentHeightRef.current = contentSize.height;
      viewportHeightRef.current = layoutMeasurement.height;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      nearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
      scheduleSnapshotEmit();
    },
    [scheduleSnapshotEmit],
  );

  useEffect(() => {
    if (hasAppliedInitialScrollRef.current) {
      return;
    }
    hasAppliedInitialScrollRef.current = true;
    if (initialScroll?.nearBottom) {
      nearBottomRef.current = true;
    } else if (initialScroll) {
      nearBottomRef.current = initialScroll.nearBottom;
      scrollOffsetRef.current = initialScroll.offsetY;
    } else if (defaultScrollToBottom) {
      nearBottomRef.current = true;
    }
    requestAnimationFrame(() => {
      applyPendingScrollRestore();
    });
  }, [initialScroll, defaultScrollToBottom, applyPendingScrollRestore]);

  useEffect(() => {
    const firstId = messages[0]?.id;
    const prevFirstId = prevFirstMessageIdRef.current;
    const prevCount = prevMessageCountRef.current;
    const grew = messages.length > prevCount;
    const prependedOlder =
      grew &&
      prevFirstId != null &&
      firstId != null &&
      firstId !== prevFirstId;

    if (prependedOlder) {
      nearBottomRef.current = false;
    } else if (prevCount === 0 && messages.length > 0) {
      if (initialScroll != null) {
        nearBottomRef.current = initialScroll.nearBottom;
      } else if (defaultScrollToBottom) {
        nearBottomRef.current = true;
      }
    } else if (grew && firstId === prevFirstId) {
      scheduleScrollToEnd();
    }

    prevFirstMessageIdRef.current = firstId;
    prevMessageCountRef.current = messages.length;
  }, [
    messages,
    initialScroll,
    defaultScrollToBottom,
    scheduleScrollToEnd,
  ]);

  useEffect(() => {
    if (!streamingText && !streamingThinking) {
      return;
    }
    scheduleScrollToEnd();
  }, [streamingText, streamingThinking, scheduleScrollToEnd]);

  useEffect(() => {
    return () => {
      if (snapshotThrottleRef.current != null) {
        clearTimeout(snapshotThrottleRef.current);
      }
      if (scrollToEndTimerRef.current != null) {
        clearTimeout(scrollToEndTimerRef.current);
      }
      onScrollSnapshot?.(currentScrollSnapshot());
    };
  }, [onScrollSnapshot, currentScrollSnapshot]);

  const data: (ChatListItem | {kind: 'stream'})[] = useMemo(() => {
    const list: (ChatListItem | {kind: 'stream'})[] = [...items];
    if (
      (streamingText && streamingText.length > 0) ||
      (streamingThinking && streamingThinking.length > 0) ||
      toolInvoking
    ) {
      list.push({kind: 'stream'});
    }
    return list;
  }, [items, streamingText, streamingThinking, toolInvoking]);

  const renderAssistantBubble = (
    body: string,
    thinking: string,
    tools: readonly import('./message-blocks').ToolCallView[],
    selected: boolean,
    inRange: boolean,
    hidden: boolean,
    messageId: string,
    options?: {
      defaultExpandedThinking?: boolean;
      forcePlainText?: boolean;
      showToolInvoking?: boolean;
    },
  ) => {
    const trimmedThinking = thinking.trim();
    const trimmedBody = body.trim();
    const showToolInvoking = options?.showToolInvoking ?? false;
    if (!trimmedThinking && !trimmedBody && tools.length === 0 && !showToolInvoking) {
      return null;
    }
    const colors = chatBubbleColors(tokens, false);
    const bubbleFillWidth =
      !trimmedBody &&
      (trimmedThinking.length > 0 || tools.length > 0 || showToolInvoking);
    return (
      <View
        style={[
          styles.bubble,
          bubbleFillWidth && styles.bubbleFillWidth,
          {
            backgroundColor: colors.backgroundColor,
            opacity: hidden ? 0.55 : 1,
          },
          batchMode && selected && {
            borderColor: tokens.danger,
            borderWidth: 2,
          },
          batchMode && inRange && !selected && {
            borderColor: tokens.danger,
            borderWidth: 1,
            opacity: hidden ? 0.55 : 0.95,
          },
        ]}>
        {trimmedThinking ? (
          <ThinkingBlockCard
            text={trimmedThinking}
            defaultExpanded={options?.defaultExpandedThinking}
            dimmed={hidden}
            richTextEnabled={chatRichTextEnabled}
            richRenderEpoch={richRenderEpoch}
            contentId={`thinking-${messageId}`}
            embedded
            showDividerBelow={!!trimmedBody || tools.length > 0 || showToolInvoking}
          />
        ) : null}
        {trimmedBody
          ? options?.forcePlainText ? (
              <Text style={{color: colors.bodyColor}}>{trimmedBody}</Text>
            ) : (
              <ChatMessageBody
                body={trimmedBody}
                tokens={tokens}
                isUser={false}
                richTextEnabled={chatRichTextEnabled}
                richRenderEpoch={richRenderEpoch}
                messageId={messageId}
                bodyColor={colors.bodyColor}
              />
            )
          : null}
        {showToolInvoking ? (
          <ToolTurnPhaseBar embedded label="工具调用中" />
        ) : null}
        {tools.length > 0 ? (
          <ToolCallGroupCard
            tools={tools}
            dimmed={hidden}
            onOpenFile={onOpenToolFile}
            embedded
          />
        ) : null}
      </View>
    );
  };

  const renderUserBubble = (
    body: string,
    selected: boolean,
    inRange: boolean,
    hidden: boolean,
    messageId: string,
  ) => {
    const colors = chatBubbleColors(tokens, true);
    return (
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.backgroundColor,
            opacity: hidden ? 0.55 : 1,
          },
          batchMode && selected && {
            borderColor: tokens.danger,
            borderWidth: 2,
          },
          batchMode && inRange && !selected && {
            borderColor: tokens.danger,
            borderWidth: 1,
            opacity: hidden ? 0.55 : 0.95,
          },
        ]}>
        <ChatMessageBody
          body={body}
          tokens={tokens}
          isUser
          richTextEnabled={chatRichTextEnabled}
          richRenderEpoch={richRenderEpoch}
          messageId={messageId}
          bodyColor={colors.bodyColor}
        />
      </View>
    );
  };

  const isBatchRowSelectable = (
    role: string,
    mode: MessageBatchMode | null | undefined,
  ): boolean => {
    if (mode == null) {
      return false;
    }
    if (isTailBatchMode(mode)) {
      return true;
    }
    return isTranscriptRowSelectable(transcriptSelectableRole(role, mode));
  };

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={data}
      contentOffset={mountContentOffsetRef.current}
      extraData={{chatRichTextEnabled, richRenderEpoch}}
      ListHeaderComponent={listHeaderComponent ?? undefined}
      maintainVisibleContentPosition={{
        minIndexForVisible: 0,
        autoscrollToTopThreshold: 10,
      }}
      onScroll={syncNearBottomFromScroll}
      scrollEventThrottle={16}
      onContentSizeChange={(_w, height) => {
        const prevHeight = contentHeightRef.current;
        contentHeightRef.current = height;
        if (pendingScrollRestoreRef.current) {
          applyPendingScrollRestore(height);
          return;
        }
        const shrank = height < prevHeight && prevHeight > 0;
        if (shrank && !nearBottomRef.current) {
          const maxOffset = Math.max(0, height - viewportHeightRef.current);
          const clamped = Math.min(scrollOffsetRef.current, maxOffset);
          scrollOffsetRef.current = clamped;
          listRef.current?.scrollToOffset({offset: clamped, animated: false});
          return;
        }
        scheduleScrollToEnd();
      }}
      onLayout={() => {
        if (pendingScrollRestoreRef.current) {
          applyPendingScrollRestore();
        }
      }}
      keyExtractor={item => {
        if ('kind' in item && item.kind === 'stream') {
          return 'stream';
        }
        if (item.kind === 'user_vfs_turn') {
          return `vfs-turn-${item.id}`;
        }
        return `msg-${item.message.id}`;
      }}
      ListEmptyComponent={
        !streamingText && !streamingThinking && !toolInvoking ? (
          <Text style={[styles.empty, {color: tokens.textSecondary}]}>
            暂无消息，发送一条开始对话
          </Text>
        ) : null
      }
      renderItem={({item}) => {
        if ('kind' in item && item.kind === 'stream') {
          return (
            <View style={styles.rowAlignAssistant}>
              {renderAssistantBubble(
                streamingText ?? '',
                streamingThinking ?? '',
                [],
                false,
                false,
                false,
                'stream',
                {
                  defaultExpandedThinking: true,
                  forcePlainText: true,
                  showToolInvoking: toolInvoking,
                },
              )}
            </View>
          );
        }
        if (item.kind === 'user_vfs_turn') {
          if (item.tools.length === 0) {
            return null;
          }
          const hidden = item.hidden;
          const selected = selectedMessageIds?.has(item.id) ?? false;
          const inRange = affectedMessageIds?.has(item.id) ?? false;
          const colors = chatBubbleColors(tokens, true);
          const content = (
            <View
              style={[
                styles.bubble,
                styles.bubbleFillWidth,
                {
                  backgroundColor: colors.backgroundColor,
                  opacity: hidden ? 0.55 : 1,
                },
                batchMode && selected && {
                  borderColor: tokens.danger,
                  borderWidth: 2,
                },
                batchMode && inRange && !selected && {
                  borderColor: tokens.danger,
                  borderWidth: 1,
                  opacity: hidden ? 0.55 : 0.95,
                },
              ]}>
              <ToolCallGroupCard
                tools={item.tools}
                dimmed={hidden}
                onOpenFile={onOpenToolFile}
                embedded
              />
            </View>
          );
          const rowSelectable = isBatchRowSelectable('user', batchMode);
          if (batchMode) {
            return (
              <View style={styles.batchRow} accessibilityState={{selected}}>
                {rowSelectable ? (
                  <Pressable
                    style={styles.batchCheckboxCol}
                    onPress={() => onToggleMessageSelect?.(item.id)}>
                    <BatchCheckbox
                      checked={selected}
                      accentColor={tokens.danger}
                      onToggle={() => onToggleMessageSelect?.(item.id)}
                    />
                  </Pressable>
                ) : (
                  <View style={styles.batchCheckboxCol} />
                )}
                <View style={[styles.batchBubbleCol, styles.batchBubbleColUser]}>
                  {content}
                </View>
              </View>
            );
          }
          return (
            <View style={[styles.rowAlign, styles.rowAlignUser]}>{content}</View>
          );
        }

        const row = item;
        const isUser = row.message.role === 'user';
        const hidden = row.message.hidden;
        const body = row.textParts.join('\n\n');
        const thinking = row.thinkingParts.join('\n\n');
        if (!body && !thinking && row.tools.length === 0) {
          return null;
        }
        const selected = selectedMessageIds?.has(row.message.id) ?? false;
        const inRange = affectedMessageIds?.has(row.message.id) ?? false;
        const content = isUser ? (
          renderUserBubble(body, selected, inRange, hidden, row.message.id)
        ) : (
          renderAssistantBubble(
            body,
            thinking,
            row.tools,
            selected,
            inRange,
            hidden,
            row.message.id,
          )
        );

        const rowSelectable = isBatchRowSelectable(row.message.role, batchMode);

        if (batchMode) {
          return (
            <View style={styles.batchRow} accessibilityState={{selected}}>
              {rowSelectable ? (
                <Pressable
                  style={styles.batchCheckboxCol}
                  onPress={() => onToggleMessageSelect?.(row.message.id)}>
                  <BatchCheckbox
                    checked={selected}
                    accentColor={tokens.danger}
                    onToggle={() => onToggleMessageSelect?.(row.message.id)}
                  />
                </Pressable>
              ) : (
                <View style={styles.batchCheckboxCol} />
              )}
              <View
                style={[
                  styles.batchBubbleCol,
                  isUser
                    ? styles.batchBubbleColUser
                    : styles.batchBubbleColAssistant,
                ]}>
                {content}
              </View>
            </View>
          );
        }

        return (
          <MessageLongPressRow
            isUser={isUser}
            onLongPress={anchor => onMessageLongPress?.(row.message, anchor)}>
            {content}
          </MessageLongPressRow>
        );
      }}
    />
  );
}

type MessageLongPressRowProps = {
  isUser: boolean;
  onLongPress: (anchor: MessageMenuAnchor) => void;
  children: React.ReactNode;
};

/** Measures bubble window rect at long-press time for anchored action menu. */
function MessageLongPressRow({
  isUser,
  onLongPress,
  children,
}: MessageLongPressRowProps) {
  const rowRef = useRef<View>(null);
  return (
    <Pressable
      ref={rowRef}
      style={[
        styles.rowAlign,
        isUser ? styles.rowAlignUser : styles.rowAlignAssistant,
      ]}
      onLongPress={() => {
        rowRef.current?.measureInWindow((x, y, width, height) => {
          onLongPress({x, y, width, height});
        });
      }}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {flex: 1},
  empty: {textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
  rowAlign: {
    width: '100%',
    paddingHorizontal: 12,
  },
  rowAlignUser: {
    alignItems: 'flex-end',
  },
  rowAlignAssistant: {
    alignItems: 'flex-start',
  },
  /** Checkbox column fixed at screen left; bubble aligns in the remaining width. */
  batchRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 4,
    paddingRight: 12,
  },
  batchCheckboxCol: {
    width: 28,
    paddingTop: 8,
    alignItems: 'center',
  },
  batchBubbleCol: {
    flex: 1,
    minWidth: 0,
  },
  batchBubbleColUser: {
    alignItems: 'flex-end',
  },
  batchBubbleColAssistant: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
    flexShrink: 1,
  },
  /** Thinking/tools-only assistant bubbles — avoid shrink-to-header width. */
  bubbleFillWidth: {
    width: '85%',
  },
});

