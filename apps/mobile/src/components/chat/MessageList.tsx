/**
 * Session message list with tool cards, streaming tail, and optional batch select.
 */
import React, {useMemo} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
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
  /** When true, assistant bubbles use RichContentBody (streaming tail stays plain Text). */
  assistantRichTextEnabled?: boolean;
  batchMode?: boolean;
  selectedMessageIds?: ReadonlySet<string>;
  onToggleMessageSelect?: (messageId: string) => void;
  onMessageLongPress?: (message: ChatMessage) => void;
};

interface AssistantMessageBodyProps {
  body: string;
  tokens: ThemeTokens;
  richTextEnabled: boolean;
}

/** Assistant bubble body: plain Text when pref off, else shared rich renderer. */
const AssistantMessageBody = React.memo(function AssistantMessageBody({
  body,
  tokens,
  richTextEnabled,
}: AssistantMessageBodyProps) {
  if (!richTextEnabled || isRichContentOverLimit(body)) {
    return <Text style={{color: tokens.text}}>{body}</Text>;
  }
  return (
    <RichContentBody
      content={body}
      tokens={tokens}
      variant="chat-assistant"
    />
  );
});

export function MessageList({
  messages,
  streamingText,
  streamingThinking,
  showFullToolParams,
  assistantRichTextEnabled = false,
  batchMode = false,
  selectedMessageIds,
  onToggleMessageSelect,
  onMessageLongPress,
}: Props) {
  const {tokens} = useTheme();
  const items = useMemo(() => buildChatListItems(messages), [messages]);

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
    /** Streaming tail always plain Text even when assistant rich text is on. */
    forcePlainText = false,
  ) => (
    <View
      style={[
        styles.bubble,
        {
          backgroundColor: isUser ? tokens.primary : tokens.surface,
        },
        batchMode && selected && {
          borderColor: tokens.primary,
          borderWidth: 2,
        },
      ]}>
      {isUser ? (
        <Text style={{color: '#fff'}}>{body}</Text>
      ) : forcePlainText ? (
        <Text style={{color: tokens.text}}>{body}</Text>
      ) : (
        <AssistantMessageBody
          body={body}
          tokens={tokens}
          richTextEnabled={assistantRichTextEnabled}
        />
      )}
    </View>
  );

  return (
    <FlatList
      style={styles.list}
      data={data}
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
                ? renderBubble(false, streamingText, false, true)
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
            />
          );
        }
        const isUser = row.message.role === 'user';
        const body = row.textParts.join('\n\n');
        const thinking = row.thinkingParts.join('\n\n');
        if (!body && !thinking) {
          return null;
        }
        const selected = selectedMessageIds?.has(row.message.id) ?? false;
        const content = (
          <>
            {!isUser && thinking ? (
              <ThinkingBlockCard text={thinking} />
            ) : null}
            {body ? renderBubble(isUser, body, selected) : null}
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
          <Pressable
            style={[
              styles.rowAlign,
              isUser ? styles.rowAlignUser : styles.rowAlignAssistant,
            ]}
            onLongPress={() => onMessageLongPress?.(row.message)}>
            {content}
          </Pressable>
        );
      }}
    />
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
