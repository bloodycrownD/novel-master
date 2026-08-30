/**
 * Collapsible model reasoning (thinking block), embedded in assistant bubbles by default.
 */
import React, {useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {CollapsibleCard} from '@/components/ui/CollapsibleCard';
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
    expanded && richTextEnabled && !isRichContentOverLimit(trimmed);

  return (
    <CollapsibleCard
      expanded={expanded}
      onToggle={setExpanded}
      title={
        <Text style={[styles.title, {color: tokens.textSecondary}]}>
          思考过程
        </Text>
      }
      style={[
        embedded ? styles.embedded : styles.card,
        !embedded && {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
        {opacity: dimmed ? 0.55 : 1},
      ]}
      showDividerBelow={showDividerBelow}
    >
      {useRich ? (
        <RichContentBody
          content={trimmed}
          tokens={tokens}
          fallbackTextColor={tokens.textSecondary}
        />
      ) : (
        <Text style={[styles.body, {color: tokens.textSecondary}]}>
          {trimmed}
        </Text>
      )}
    </CollapsibleCard>
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
  title: {fontSize: 12, fontWeight: '600'},
  body: {fontSize: 13, lineHeight: 19, marginTop: 6},
});
