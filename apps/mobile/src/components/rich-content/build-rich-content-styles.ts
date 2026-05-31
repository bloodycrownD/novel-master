import {StyleSheet} from 'react-native';
import type {MixedStyleRecord} from 'react-native-render-html';
import type {ThemeTokens} from '../../theme/tokens';

export type RichContentVariant = 'chat-assistant' | 'file-preview';

const VARIANT_BODY = {
  'chat-assistant': {fontSize: 15, lineHeight: 22},
  'file-preview': {fontSize: 16, lineHeight: 24},
} as const;

const VARIANT_HEADING = {
  'chat-assistant': {h1: 22, h2: 19, h3: 17},
  'file-preview': {h1: 26, h2: 22, h3: 18},
} as const;

export interface RichContentStyles {
  baseStyle: MixedStyleRecord;
  tagsStyles: Record<string, MixedStyleRecord>;
}

/**
 * Theme-aware base and tag styles for {@link RichContentBody} (migrated from vfs markdown styles).
 */
export function buildRichContentStyles(
  tokens: ThemeTokens,
  variant: RichContentVariant,
): RichContentStyles {
  const body = VARIANT_BODY[variant];
  const headings = VARIANT_HEADING[variant];

  const baseStyle: MixedStyleRecord = {
    color: tokens.text,
    fontSize: body.fontSize,
    lineHeight: body.lineHeight,
  };

  const tagsStyles: Record<string, MixedStyleRecord> = {
    body: baseStyle,
    p: {marginTop: 0, marginBottom: 10},
    h1: {
      color: tokens.text,
      fontSize: headings.h1,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 8,
    },
    h2: {
      color: tokens.text,
      fontSize: headings.h2,
      fontWeight: '600',
      marginTop: 8,
      marginBottom: 6,
    },
    h3: {
      color: tokens.text,
      fontSize: headings.h3,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 4,
    },
    ul: {marginBottom: 8},
    ol: {marginBottom: 8},
    li: {marginBottom: 4},
    code: {
      backgroundColor: tokens.bgSecondary,
      color: tokens.text,
      fontFamily: 'monospace',
      fontSize: 14,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    pre: {
      backgroundColor: tokens.bgSecondary,
      color: tokens.text,
      fontFamily: 'monospace',
      fontSize: 13,
      padding: 10,
      borderRadius: 8,
      marginVertical: 8,
    },
    blockquote: {
      backgroundColor: tokens.bgSecondary,
      borderLeftColor: tokens.primary,
      borderLeftWidth: 3,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 8,
    },
    a: {color: tokens.primary, textDecorationLine: 'underline'},
    strong: {fontWeight: '700'},
    em: {fontStyle: 'italic'},
    hr: {
      backgroundColor: tokens.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 8,
    },
    div: {marginBottom: 4},
    span: {},
    table: {
      borderColor: tokens.border,
      borderWidth: StyleSheet.hairlineWidth,
      marginVertical: 8,
    },
    th: {
      backgroundColor: tokens.bgSecondary,
      padding: 6,
      fontWeight: '600',
    },
    td: {
      padding: 6,
      borderColor: tokens.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
  };

  return {baseStyle, tagsStyles};
}
