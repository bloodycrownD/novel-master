/**
 * Shared MD/HTML body renderer (chat assistant + file preview).
 */
import React, {useMemo} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import RenderHTML from 'react-native-render-html';
import type {ThemeTokens} from '../../theme/tokens';
import {
  buildRichContentStyles,
  type RichContentVariant,
} from './build-rich-content-styles';
import {prepareRichHtml} from './prepare-rich-html';
import {RICH_CONTENT_MAX_CHARS} from './rich-content-limits';

const BUBBLE_HORIZONTAL_INSET = 12;
const LIST_HORIZONTAL_PADDING = 12;
const BUBBLE_MAX_WIDTH_RATIO = 0.85;

export interface RichContentBodyProps {
  content: string;
  tokens: ThemeTokens;
  variant: RichContentVariant;
}

function RichContentBodyInner({
  content,
  tokens,
  variant,
}: RichContentBodyProps) {
  const {width: windowWidth} = useWindowDimensions();
  const overLimit = content.length > RICH_CONTENT_MAX_CHARS;

  const html = useMemo(
    () => (overLimit ? '' : prepareRichHtml(content)),
    [content, overLimit],
  );

  const {baseStyle, tagsStyles} = useMemo(
    () => buildRichContentStyles(tokens, variant),
    [tokens, variant],
  );

  const contentWidth = useMemo(() => {
    const bubbleOuter =
      windowWidth * BUBBLE_MAX_WIDTH_RATIO -
      LIST_HORIZONTAL_PADDING * 2 -
      BUBBLE_HORIZONTAL_INSET * 2;
    return Math.max(200, Math.floor(bubbleOuter));
  }, [windowWidth]);

  // Length guard: skip RenderHTML to avoid FlatList jank on huge bodies.
  if (overLimit) {
    return (
      <View>
        <Text style={[styles.fallbackText, {color: tokens.text}]}>
          {content}
        </Text>
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          内容过长，已显示原文
        </Text>
      </View>
    );
  }

  return (
    <RenderHTML
      contentWidth={contentWidth}
      source={{html}}
      baseStyle={baseStyle}
      tagsStyles={tagsStyles}
      defaultTextProps={{selectable: true}}
    />
  );
}

export const RichContentBody = React.memo(RichContentBodyInner);

const styles = StyleSheet.create({
  fallbackText: {fontSize: 15, lineHeight: 22},
  hint: {fontSize: 12, marginTop: 6},
});
