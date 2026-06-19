/**
 * Collapsible model reasoning (thinking block), embedded in assistant bubbles by default.
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {RichContentBody} from '@/components/rich-content/RichContentBody';
import {isRichContentOverLimit} from '@/components/rich-content/rich-content-limits';
import {useTheme} from '@/theme/ThemeProvider';

type Props = {
  text: string;
  /** When true, card starts expanded (e.g. live streaming). */
  defaultExpanded?: boolean;
  /** Grey out when parent message is hidden from prompt. */
  dimmed?: boolean;
  /** Same pref as assistant bubbles; uses RichContentBody when on. */
  richTextEnabled?: boolean;
  richRenderEpoch?: number;
  contentId?: string;
  /** Inside assistant bubble (no standalone card chrome). */
  embedded?: boolean;
  /** Divider below expanded thinking when reply text follows. */
  showDividerBelow?: boolean;
};

export function ThinkingBlockCard({
  text,
  defaultExpanded = false,
  dimmed = false,
  richTextEnabled = false,
  richRenderEpoch = 0,
  contentId = 'thinking',
  embedded = true,
  showDividerBelow = false,
}: Props) {
  const {tokens} = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const useRich =
    expanded &&
    richTextEnabled &&
    !isRichContentOverLimit(trimmed);

  return (
    <View
      style={[
        embedded ? styles.embedded : styles.card,
        !embedded && {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
        {opacity: dimmed ? 0.55 : 1},
      ]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded}}>
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          思考过程
        </Text>
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
          {expanded ? '▼' : '▶'}
        </Text>
      </Pressable>
      {expanded ? (
        useRich ? (
          <View
            style={
              showDividerBelow
                ? {
                    borderBottomColor: tokens.borderLight,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    marginBottom: 8,
                    paddingBottom: 8,
                  }
                : undefined
            }>
            <RichContentBody
              content={trimmed}
              tokens={tokens}
              variant="chat-assistant"
              fallbackTextColor={tokens.textSecondary}
              renderKey={`${contentId}:${richRenderEpoch}`}
            />
          </View>
        ) : (
          <Text
            style={[
              styles.body,
              {color: tokens.textSecondary},
              showDividerBelow && {
                borderBottomColor: tokens.borderLight,
                borderBottomWidth: StyleSheet.hairlineWidth,
                marginBottom: 8,
                paddingBottom: 8,
              },
            ]}>
            {trimmed}
          </Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxWidth: '85%',
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  embedded: {
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {fontSize: 12, fontWeight: '600'},
  chevron: {fontSize: 10},
  body: {fontSize: 13, lineHeight: 19, marginTop: 6},
});
