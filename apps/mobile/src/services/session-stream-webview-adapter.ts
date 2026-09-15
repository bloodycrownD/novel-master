/**
 * 单元流式句柄 → ChatTranscriptWebView handle 的适配器（Step 6 屏幕接线）。
 *
 * ChatTabProvider（主会话屏）与 SubagentSessionScreen（子会话屏）共用的
 * 适配层：把单元的流式载荷/控制消息映射到 webview handle 的哑引擎契约——
 * - stream-batch → pushStreamBatch({segments})；
 * - stream-delta → pushStreamDelta(kind, delta)；
 * - reset-stream → resetStream；
 * - force-snapshot → forceSnapshot（直发全量快照，绕过 defer 拦截）。
 *
 * SessionStreamWebviewHandle 的回调参数为 unknown（线上形状由单元模块
 * 定义），本适配器负责收窄——屏幕侧不再各自手写映射。
 */
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import type {
  SessionStreamUnitControlMessage,
  SessionStreamUnitStreamPayload,
  SessionStreamWebviewHandle,
} from '@/services/session-stream-unit';

export function createTranscriptStreamHandle(
  handleId: string,
  web: ChatTranscriptWebViewHandle,
): SessionStreamWebviewHandle {
  return {
    handleId,
    onStreamPayload: payload => {
      const typed = payload as SessionStreamUnitStreamPayload;
      if (typed.type === 'stream-batch') {
        web.pushStreamBatch({segments: typed.segments});
      } else if (typed.type === 'stream-delta') {
        web.pushStreamDelta(typed.kind, typed.delta);
      }
    },
    onControlMessage: message => {
      const typed = message as SessionStreamUnitControlMessage;
      if (typed.type === 'reset-stream') {
        web.resetStream();
      } else if (typed.type === 'force-snapshot') {
        web.forceSnapshot();
      }
    },
  };
}
