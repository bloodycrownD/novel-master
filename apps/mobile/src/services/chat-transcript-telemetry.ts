/** Dev default on; production off — mirrors chat-list-telemetry pattern. */
export const CHAT_TRANSCRIPT_TELEMETRY_ENABLED =
  typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export type ChatTranscriptTelemetryEvent =
  | {
      readonly name: 'transcript_ready';
      readonly sessionKey: string;
      readonly rowCount: number;
      readonly hasInitialScroll: boolean;
      readonly defaultScrollToBottom: boolean;
    }
  | {
      readonly name: 'scroll_restore';
      readonly mode: 'near_bottom' | 'offset' | 'stick';
      readonly offsetY?: number;
      readonly nearBottom?: boolean;
    }
  | {
      readonly name: 'prepend_detected';
      readonly prependedCount: number;
      readonly wasNearBottom: boolean;
      readonly offsetYBefore: number;
    }
  | {
      readonly name: 'menu_open';
    };

export function emitChatTranscriptTelemetry(
  event: ChatTranscriptTelemetryEvent,
): void {
  if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) {
    return;
  }
  console.info('[ChatTranscriptTelemetry]', event.name, event);
}
