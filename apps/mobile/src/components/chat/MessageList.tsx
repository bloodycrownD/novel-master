/**
 * Session message list with tool cards and optional streaming tail.
 */
import React, {useMemo} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import type {ChatMessage} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';
import {buildChatListItems, type ChatListItem} from './message-blocks';
import {ToolCallCard} from './ToolCallCard';

type Props = {
  messages: readonly ChatMessage[];
  streamingText?: string;
  showFullToolParams?: boolean;
};

export function MessageList({
  messages,
  streamingText,
  showFullToolParams,
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
        return (
          <View
            style={[
              styles.bubble,
              isUser ? styles.userBubble : styles.assistantBubble,
              {
                backgroundColor: isUser ? tokens.primary : tokens.surface,
                alignSelf: isUser ? 'flex-end' : 'flex-start',
              },
            ]}>
            <Text style={{color: isUser ? '#fff' : tokens.text}}>{body}</Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {flex: 1},
  empty: {textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
  bubble: {
    maxWidth: '85%',
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
  },
  userBubble: {},
  assistantBubble: {},
});
