/**
 * Session message list with tool cards, streaming tail, and optional batch select.
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
import type {ChatMessage} from '@novel-master/core';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {RichContentBody} from '../rich-content/RichContentBody';
import {isRichContentOverLimit} from '../rich-content/rich-content-limits';
import {useTheme} from '../../theme/ThemeProvider';
import type {ThemeTokens} from '../../theme/tokens';
import {buildChatListItems, type ChatListItem} from './message-blocks';
import {ThinkingBlockCard} from './ThinkingBlockCard';
import {ToolCallCard} from './ToolCallCard';

type Props = {
  messages: readonly ChatMessage[];
  streamingText?: string;
  streamingThinking?: string;
  showFullToolParams?: boolean;
  /** When true, user + assistant bubbles use RichContentBody (streaming tail stays plain Text). */
  chatRichTextEnabled?: boolean;
  /** Bumped on app upgrade to remount rich renderers (see app-version-guard). */
  richRenderEpoch?: number;
  batchMode?: boolean;
  selectedMessageIds?: ReadonlySet<string>;
  onToggleMessageSelect?: (messageId: string) => void;
  onMessageLongPress?: (
    message: ChatMessage,
    anchor: MessageMenuAnchor,
  ) => void;
  /** Shown at the top of the timeline (e.g. load older history). */
  listHeaderComponent?: React.ReactElement | null;
  /** Open session VFS file from vfs.read / write / replace tool cards. */
  onOpenToolFile?: (path: string) => void;
};

/** Within this distance from the bottom we treat the user as "following" the tail. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

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
  showFullToolParams,
  chatRichTextEnabled = false,
  richRenderEpoch = 0,
  batchMode = false,
  selectedMessageIds,
  onToggleMessageSelect,
  onMessageLongPress,
  listHeaderComponent,
  onOpenToolFile,
}: Props) {
  const {tokens} = useTheme();
  const listRef = useRef<FlatList<ChatListItem | {kind: 'stream'}>>(null);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const prevMessageCountRef = useRef(0);
  const nearBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);

  const items = useMemo(() => buildChatListItems(messages), [messages]);

  const syncNearBottomFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      scrollOffsetRef.current = contentOffset.y;
      contentHeightRef.current = contentSize.height;
      viewportHeightRef.current = layoutMeasurement.height;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      nearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    },
    [],
  );

  const scrollToEndIfNearBottom = useCallback(() => {
    if (!nearBottomRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({animated: false});
    });
  }, []);

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
      nearBottomRef.current = true;
      scrollToEndIfNearBottom();
    } else if (grew && firstId === prevFirstId) {
      scrollToEndIfNearBottom();
    }

    prevFirstMessageIdRef.current = firstId;
    prevMessageCountRef.current = messages.length;
  }, [messages, scrollToEndIfNearBottom]);

  useEffect(() => {
    if (!streamingText && !streamingThinking) {
      return;
    }
    scrollToEndIfNearBottom();
  }, [streamingText, streamingThinking, scrollToEndIfNearBottom]);

  const data: (ChatListItem | {kind: 'stream'})[] = useMemo(() => {
    const list: (ChatListItem | {kind: 'stream'})[] = [...items];
    if (
      (streamingText && streamingText.length > 0) ||
      (streamingThinking && streamingThinking.length > 0)
    ) {
      list.push({kind: 'stream'});
    }
    return list;
  }, [items, streamingText, streamingThinking]);

  const renderBubble = (
    isUser: boolean,
    body: string,
    selected: boolean,
    hidden: boolean,
    messageId: string,
    /** Streaming tail always plain Text even when assistant rich text is on. */
    forcePlainText = false,
  ) => {
    const colors = chatBubbleColors(tokens, isUser);
    return (
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.backgroundColor,
            opacity: hidden ? 0.55 : 1,
          },
          batchMode && selected && {
            borderColor: tokens.primary,
            borderWidth: 2,
          },
        ]}>
        {forcePlainText ? (
          <Text style={{color: colors.bodyColor}}>{body}</Text>
        ) : (
          <ChatMessageBody
            body={body}
            tokens={tokens}
            isUser={isUser}
            richTextEnabled={chatRichTextEnabled}
            richRenderEpoch={richRenderEpoch}
            messageId={messageId}
            bodyColor={colors.bodyColor}
          />
        )}
      </View>
    );
  };

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      data={data}
      extraData={{chatRichTextEnabled, richRenderEpoch}}
      ListHeaderComponent={listHeaderComponent ?? undefined}
      maintainVisibleContentPosition={{
        minIndexForVisible: 0,
        autoscrollToTopThreshold: 10,
      }}
      onScroll={syncNearBottomFromScroll}
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        // Only follow tail when onScroll already marked the user near the bottom.
        scrollToEndIfNearBottom();
      }}
      keyExtractor={(item, index) => {
        if ('kind' in item && item.kind === 'stream') {
          return 'stream';
        }
        const row = item as ChatListItem;
        if (row.kind === 'tool') {
          return `tool-${row.tool.toolUseId}`;
        }
        return `msg-${row.message.id}`;
      }}
      ListEmptyComponent={
        !streamingText ? (
          <Text style={[styles.empty, {color: tokens.textSecondary}]}>
            暂无消息，发送一条开始对话
          </Text>
        ) : null
      }
      renderItem={({item}) => {
        if ('kind' in item && item.kind === 'stream') {
          return (
            <View style={styles.rowAlignAssistant}>
              {streamingThinking && streamingThinking.length > 0 ? (
                <ThinkingBlockCard
                  text={streamingThinking}
                  defaultExpanded
                />
              ) : null}
              {streamingText && streamingText.length > 0
                ? renderBubble(false, streamingText, false, false, 'stream', true)
                : null}
            </View>
          );
        }
        const row = item as ChatListItem;
        if (row.kind === 'tool') {
          return (
            <ToolCallCard
              tool={row.tool}
              showFullParams={showFullToolParams}
              onOpenFile={onOpenToolFile}
            />
          );
        }
        const isUser = row.message.role === 'user';
        const hidden = row.message.hidden;
        const body = row.textParts.join('\n\n');
        const thinking = row.thinkingParts.join('\n\n');
        if (!body && !thinking) {
          return null;
        }
        const selected = selectedMessageIds?.has(row.message.id) ?? false;
        const content = (
          <>
            {!isUser && thinking ? (
              <ThinkingBlockCard text={thinking} dimmed={hidden} />
            ) : null}
            {body
              ? renderBubble(
                  isUser,
                  body,
                  selected,
                  hidden,
                  row.message.id,
                )
              : null}
          </>
        );

        if (batchMode) {
          return (
            <Pressable
              style={styles.batchRow}
              onPress={() => onToggleMessageSelect?.(row.message.id)}>
              <View style={styles.batchCheckboxCol}>
                <BatchCheckbox
                  checked={selected}
                  onToggle={() => onToggleMessageSelect?.(row.message.id)}
                />
              </View>
              <View
                style={[
                  styles.batchBubbleCol,
                  isUser
                    ? styles.batchBubbleColUser
                    : styles.batchBubbleColAssistant,
                ]}>
                {content}
              </View>
            </Pressable>
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
    width: 36,
    paddingTop: 10,
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
});
