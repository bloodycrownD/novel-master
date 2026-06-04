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
import {isRichContentOverLimit} from './rich-content-limits';

const BUBBLE_HORIZONTAL_INSET = 12;
const LIST_HORIZONTAL_PADDING = 12;
const BUBBLE_MAX_WIDTH_RATIO = 0.85;
/** Matches FileEditorScreen previewContent horizontal padding. */
const FILE_PREVIEW_HORIZONTAL_PADDING = 12;

export interface RichContentBodyProps {
  content: string;
  tokens: ThemeTokens;
  variant: RichContentVariant;
  /** Plain-text fallback when over limit or prepare fails (default tokens.text). */
  fallbackTextColor?: string;
  /** Forces RenderHTML remount when app version epoch changes. */
  renderKey?: string;
}

function RichContentBodyInner({
  content,
  tokens,
  variant,
  fallbackTextColor,
  renderKey,
}: RichContentBodyProps) {
  const {width: windowWidth} = useWindowDimensions();
  const overLimit = isRichContentOverLimit(content);

  const prepared = useMemo(() => {
    if (overLimit) {
      return null;
    }
    try {
      return prepareRichHtml(content);
    } catch (error) {
      if (__DEV__) {
        console.warn('[RichContentBody] prepare failed, showing plain text', error);
      }
      return null;
    }
  }, [content, overLimit]);

  const {baseStyle, tagsStyles} = useMemo(
    () => buildRichContentStyles(tokens, variant),
    [tokens, variant],
  );

  const classesStyles = prepared?.classesStyles;

  const contentWidth = useMemo(() => {
    if (variant === 'file-preview') {
      return Math.max(
        200,
        Math.floor(windowWidth - FILE_PREVIEW_HORIZONTAL_PADDING * 2),
      );
    }
    // chat-assistant and chat-user share bubble width math
    const bubbleOuter =
      windowWidth * BUBBLE_MAX_WIDTH_RATIO -
      LIST_HORIZONTAL_PADDING * 2 -
      BUBBLE_HORIZONTAL_INSET * 2;
    return Math.max(200, Math.floor(bubbleOuter));
  }, [windowWidth, variant]);

  const plainColor = fallbackTextColor ?? tokens.text;

  // Length guard or pipeline failure → plain text (never blank bubble).
  if (overLimit || prepared == null) {
    return (
      <View>
        <Text style={[styles.fallbackText, {color: plainColor}]}>
          {content}
        </Text>
        {overLimit ? (
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            内容过长，已显示原文
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{width: contentWidth, maxWidth: '100%'}}>
      <RenderHTML
        key={renderKey}
        contentWidth={contentWidth}
        source={{html: prepared.html}}
        baseStyle={baseStyle}
        tagsStyles={tagsStyles}
        classesStyles={classesStyles ?? undefined}
        enableCSSInlineProcessing
        defaultTextProps={{selectable: true}}
      />
    </View>
  );
}

export const RichContentBody = React.memo(RichContentBodyInner);

const styles = StyleSheet.create({
  fallbackText: {fontSize: 15, lineHeight: 22},
  hint: {fontSize: 12, marginTop: 6},
});
