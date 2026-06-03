/**
 * In-memory chat composer drafts keyed by session.
 * Survives Tab switches and ChatComposer remounts within the app process.
 */

const bySession = new Map<string, string>();

export function readChatComposerDraft(sessionId: string | undefined): string {
  if (sessionId == null || sessionId === '') {
    return '';
  }
  return bySession.get(sessionId) ?? '';
}

export function writeChatComposerDraft(
  sessionId: string | undefined,
  text: string,
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  const trimmed = text;
  if (!trimmed) {
    bySession.delete(sessionId);
    return;
  }
  bySession.set(sessionId, trimmed);
}
