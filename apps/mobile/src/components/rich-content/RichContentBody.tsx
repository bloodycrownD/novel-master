/**
 * Rollback plain-text body (legacy RN chat + VFS `rn` preview engine).
 * Primary paths use WebView + prepareTranscriptRichHtml; this component shows source as-is.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';
import {isRichContentOverLimit} from './rich-content-limits';

export interface RichContentBodyProps {
  content: string;
  tokens: ThemeTokens;
  /** @deprecated Ignored — rollback path is plain text only. */
  variant?: 'chat-assistant' | 'chat-user' | 'file-preview';
  /** Plain-text color (default tokens.text). */
  fallbackTextColor?: string;
  /** @deprecated Ignored — kept for call-site compatibility. */
  renderKey?: string;
}

function RichContentBodyInner({
  content,
  tokens,
  fallbackTextColor,
}: RichContentBodyProps) {
  const overLimit = isRichContentOverLimit(content);
  const plainColor = fallbackTextColor ?? tokens.text;

  return (
    <View>
      <Text style={[styles.plainText, {color: plainColor}]}>{content}</Text>
      {overLimit ? (
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          内容过长，已显示原文
        </Text>
      ) : null}
    </View>
  );
}

export const RichContentBody = React.memo(RichContentBodyInner);

const styles = StyleSheet.create({
  plainText: {fontSize: 15, lineHeight: 22},
  hint: {fontSize: 12, marginTop: 6},
});
