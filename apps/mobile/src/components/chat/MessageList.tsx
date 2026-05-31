/**
 * Session message list with tool cards, streaming tail, and optional batch select.
 */
import React, {useMemo} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import type {ChatMessage} from '@novel-master/core';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {useTheme} from '../../theme/ThemeProvider';
import {buildChatListItems, type ChatListItem} from './message-blocks';
import {ToolCallCard} from './ToolCallCard';

type Props = {
  messages: readonly ChatMessage[];
  streamingText?: string;
  showFullToolParams?: boolean;
  batchMode?: boolean;
  selectedMessageIds?: ReadonlySet<string>;
  onToggleMessageSelect?: (messageId: string) => void;
  onMessageLongPress?: (message: ChatMessage) => void;
};

export function MessageList({
  messages,
  streamingText,
  showFullToolParams,
  batchMode = false,
  selectedMessageIds,
  onToggleMessageSelect,
  onMessageLongPress,
}: Props) {
  const {tokens} = useTheme();
  const items = useMemo(() => buildChatListItems(messages), [messages]);

  const data: (ChatListItem | {kind: 'stream'})[] = useMemo(() => {
    const list: (ChatListItem | {kind: 'stream'})[] = [...items];
    if (streamingText && streamingText.length > 0) {
      list.push({kind: 'stream'});
    }
    return list;
  }, [items, streamingText]);

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
            <View
              style={[
                styles.bubble,
                styles.assistantBubble,
                {backgroundColor: tokens.surface},
              ]}>
              <Text style={{color: tokens.text}}>{streamingText}</Text>
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
        if (!body) {
          return null;
        }
        const selected = selectedMessageIds?.has(row.message.id) ?? false;
        const bubble = (
          <View
            style={[
              styles.bubble,
              isUser ? styles.userBubble : styles.assistantBubble,
              {
                backgroundColor: isUser ? tokens.primary : tokens.surface,
                alignSelf: isUser ? 'flex-end' : 'flex-start',
              },
              batchMode && selected && {
                borderColor: tokens.primary,
                borderWidth: 2,
              },
            ]}>
            <Text style={{color: isUser ? '#fff' : tokens.text}}>{body}</Text>
          </View>
        );

        if (batchMode) {
          return (
            <Pressable
              style={styles.messageRow}
              onPress={() => onToggleMessageSelect?.(row.message.id)}>
              <BatchCheckbox
                checked={selected}
                onToggle={() => onToggleMessageSelect?.(row.message.id)}
              />
              {bubble}
            </Pressable>
          );
        }

        return (
          <Pressable
            style={styles.messageRowPlain}
            onLongPress={() => onMessageLongPress?.(row.message)}>
            {bubble}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {flex: 1},
  empty: {textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    gap: 4,
  },
  messageRowPlain: {paddingHorizontal: 0},
  bubble: {
    flex: 1,
    maxWidth: '85%',
    marginHorizontal: 4,
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
  },
  userBubble: {},
  assistantBubble: {},
});
