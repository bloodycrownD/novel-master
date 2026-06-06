import {StyleSheet} from 'react-native';
import type {MixedStyleDeclaration} from 'react-native-render-html';
import type {ThemeTokens} from '../../theme/tokens';

export type RichContentVariant =
  | 'chat-assistant'
  | 'chat-user'
  | 'file-preview';

const VARIANT_BODY = {
  'chat-assistant': {fontSize: 15, lineHeight: 22},
  'chat-user': {fontSize: 15, lineHeight: 22},
  'file-preview': {fontSize: 16, lineHeight: 24},
} as const;

const VARIANT_HEADING = {
  'chat-assistant': {h1: 22, h2: 19, h3: 17},
  'chat-user': {h1: 22, h2: 19, h3: 17},
  'file-preview': {h1: 26, h2: 22, h3: 18},
} as const;

export interface RichContentStyles {
  baseStyle: MixedStyleDeclaration;
  tagsStyles: Record<string, MixedStyleDeclaration>;
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
  const textColor = variant === 'chat-user' ? '#ffffff' : tokens.text;
  const linkColor = variant === 'chat-user' ? '#e3f2ff' : tokens.primary;
  const codeBg =
    variant === 'chat-user' ? 'rgba(255,255,255,0.18)' : tokens.bgSecondary;

  const baseStyle: MixedStyleDeclaration = {
    fontSize: body.fontSize,
    lineHeight: body.lineHeight,
  };

  const tagsStyles: Record<string, MixedStyleDeclaration> = {
    body: {...baseStyle, color: textColor},
    p: {marginTop: 0, marginBottom: 10},
    h1: {
      color: textColor,
      fontSize: headings.h1,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 8,
    },
    h2: {
      color: textColor,
      fontSize: headings.h2,
      fontWeight: '600',
      marginTop: 8,
      marginBottom: 6,
    },
    h3: {
      color: textColor,
      fontSize: headings.h3,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 4,
    },
    ul: {marginBottom: 8},
    ol: {marginBottom: 8},
    li: {marginBottom: 4},
    code: {
      backgroundColor: codeBg,
      color: textColor,
      fontFamily: 'monospace',
      fontSize: 14,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    pre: {
      backgroundColor: codeBg,
      color: textColor,
      fontFamily: 'monospace',
      fontSize: 13,
      padding: 10,
      borderRadius: 8,
      marginVertical: 8,
    },
    blockquote: {
      backgroundColor: codeBg,
      borderLeftColor: variant === 'chat-user' ? '#ffffff' : tokens.primary,
      borderLeftWidth: 3,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 8,
    },
    a: {color: linkColor, textDecorationLine: 'underline'},
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
      backgroundColor: codeBg,
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
