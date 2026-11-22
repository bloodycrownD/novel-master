import {RichContentLimits} from '@/components/rich-content/rich-content-limits';
import {TranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';

export namespace StreamTailHtml {
    /** Pre-render stream tail HTML on RN when richText is on; Web applies `.rich` class for typography. */
    export function prepare(content: string, richText: boolean): string | undefined {
        if (!richText) {
            return undefined;
        }
        const trimmed = content.trim();
        if (!trimmed || RichContentLimits.isOverLimit(trimmed)) {
            return undefined;
        }
        return TranscriptRichHtml.prepare(trimmed);
    }
}
