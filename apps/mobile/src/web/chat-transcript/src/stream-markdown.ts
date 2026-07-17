import { decodeLiteralHtmlEntities } from '../../shared/decode-entities';
import { escapeHtmlRaw } from './html-escape';
import { state } from './state';
import { scheduleStickIfNearBottom } from './scroll';
import {
  assistantBubbleExtraClasses,
  ensureStreamTextBody,
  setStreamBodyRichClass,
  type StreamKind,
} from './stream';

export const STREAM_RICH_UPGRADE_MS = 350;

export type StreamRichUpgradeState = {
  timer: ReturnType<typeof setTimeout> | null;
  kinds: { text: boolean; thinking: boolean };
  plainMode: { text: boolean; thinking: boolean };
};

export const streamRichUpgrade: StreamRichUpgradeState = {
  timer: null,
  kinds: { text: false, thinking: false },
  plainMode: { text: true, thinking: true },
};

export function renderStreamingInline(s: string): string {
  const escaped = escapeHtmlRaw(s);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderStreamingMarkdown(text: unknown): string {
  const normalized = decodeLiteralHtmlEntities(String(text || '').trim());
  if (!normalized) return '';
  const lines = normalized.split(/\n/);
  let html = '';
  let inList: false | 'ul' | 'ol' = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html += '<ul>';
        inList = 'ul';
      } else if (inList === 'ol') {
        html += '</ol><ul>';
        inList = 'ul';
      }
      html += '<li>' + renderStreamingInline(bullet[1]) + '</li>';
      continue;
    }
    if (ordered) {
      if (!inList) {
        html += '<ol>';
        inList = 'ol';
      } else if (inList === 'ul') {
        html += '</ul><ol>';
        inList = 'ol';
      }
      html += '<li>' + renderStreamingInline(ordered[1]) + '</li>';
      continue;
    }
    if (inList) {
      html += inList === 'ul' ? '</ul>' : '</ol>';
      inList = false;
    }
    if (line.trim() === '') continue;
    html += '<p>' + renderStreamingInline(line) + '</p>';
  }
  if (inList) html += inList === 'ul' ? '</ul>' : '</ol>';
  return html;
}

export function clearStreamRichUpgrade(): void {
  if (streamRichUpgrade.timer != null) {
    clearTimeout(streamRichUpgrade.timer);
    streamRichUpgrade.timer = null;
  }
  streamRichUpgrade.kinds.text = false;
  streamRichUpgrade.kinds.thinking = false;
  streamRichUpgrade.plainMode.text = true;
  streamRichUpgrade.plainMode.thinking = true;
}

export function paintStreamRichKind(tail: Element, kind: StreamKind): void {
  const bubble = tail.querySelector('.bubble');
  if (!bubble) return;
  if (kind === 'thinking') {
    const section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
    const body = section ? section.querySelector('.thinking-body') : null;
    if (!body) return;
    const thinkingHtml = renderStreamingMarkdown(state.stream.thinking);
    if (!thinkingHtml) return;
    body.innerHTML = thinkingHtml;
    setStreamBodyRichClass(body, true);
    state.stream.thinkingHtml = thinkingHtml;
  } else {
    const textBody = ensureStreamTextBody(bubble);
    const textHtml = renderStreamingMarkdown(state.stream.text);
    if (!textHtml) return;
    textBody.innerHTML = textHtml;
    setStreamBodyRichClass(textBody, true);
    state.stream.textHtml = textHtml;
  }
  bubble.className =
    'bubble assistant' +
    assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
    );
}

export function flushStreamRichUpgrade(): void {
  streamRichUpgrade.timer = null;
  const tail = document.getElementById('stream-tail');
  if (!tail) return;
  const paintStart = Date.now();
  if (streamRichUpgrade.kinds.text) {
    paintStreamRichKind(tail, 'text');
    streamRichUpgrade.kinds.text = false;
    streamRichUpgrade.plainMode.text = false;
  }
  if (streamRichUpgrade.kinds.thinking) {
    paintStreamRichKind(tail, 'thinking');
    streamRichUpgrade.kinds.thinking = false;
    streamRichUpgrade.plainMode.thinking = false;
  }
  void paintStart;
  scheduleStickIfNearBottom();
}

export function scheduleStreamRichUpgrade(kind: StreamKind): void {
  if (!state.flags.richText) return;
  streamRichUpgrade.kinds[kind] = true;
  if (streamRichUpgrade.timer != null) return;
  streamRichUpgrade.timer = setTimeout(
    flushStreamRichUpgrade,
    STREAM_RICH_UPGRADE_MS,
  );
}
