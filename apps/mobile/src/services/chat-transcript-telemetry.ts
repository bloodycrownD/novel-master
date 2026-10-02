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
    }
  | {
      // r6-I-1：ready 协商回来的 capabilities 不含 composer-dock —— 宿主据此
      // 渲染「输入组件版本过低」横幅。原先这条路径零打点，线上「输入框不见了」
      // 无从归因（旧 dist？能力位没带？ready 没来？），故补一支事件。
      readonly name: 'composer_dock_degraded';
      /** ready 上报的能力位条数：区分「完全没带」与「带了别的、唯独缺 dock」。 */
      readonly capabilityCount: number;
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
