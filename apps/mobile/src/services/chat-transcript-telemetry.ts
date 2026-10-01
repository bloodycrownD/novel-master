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
// Step 8：`legacy_cache_discarded`（读到 v1 快照时上报）随 legacy 转录引擎退役删除——
// 读侧已无 v1 回落源，这条事件永不触发，留着只会让人以为还有双引擎在跑。

export function emitChatTranscriptTelemetry(
  event: ChatTranscriptTelemetryEvent,
): void {
  if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) {
    return;
  }
  console.info('[ChatTranscriptTelemetry]', event.name, event);
}
