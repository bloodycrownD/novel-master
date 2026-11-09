/**
 * 单元流式句柄 → ChatTranscriptWebView handle 的适配器（Step 6 屏幕接线）。
 *
 * ChatTabProvider（主会话屏）与 SubagentSessionScreen（子会话屏）共用的
 * 适配层：把单元的流式载荷/控制消息映射到 webview handle 的哑引擎契约——
 * - stream-batch → pushStream({streamId, segments, tools})（streamId 原样
 *   透传，禁止用「宿主当前 id」猜——步边界后旧批次的归属只能由单元给出）；
 * - reset-stream → resetStream(streamIds)（清掉的行 id 原样透传）；
 * - force-snapshot → forceSnapshot（直发全量快照）。
 *
 * SessionStreamWebviewHandle 的回调参数为 unknown（线上形状由单元模块
 * 定义），本适配器用显式类型判定收窄——不用 `as` 双重断言。
 */
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebViewHandle';
import {isRecord} from '@novel-master/core/common';
import type {
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
      if (!isRecord(payload) || payload.type !== 'stream-batch') {
        return;
      }
      const {streamId, segments, tools} = payload;
      if (typeof streamId !== 'string' || !Array.isArray(segments)) {
        return;
      }
      const payloadShape = {
        streamId,
        segments: segments as SessionStreamUnitStreamPayload['segments'],
        tools: tools as SessionStreamUnitStreamPayload['tools'],
      };
      web.pushStream(payloadShape);
    },
    onControlMessage: message => {
      if (!isRecord(message)) {
        return;
      }
      if (message.type === 'reset-stream' && Array.isArray(message.streamIds)) {
        const streamIds = message.streamIds as readonly string[];
        web.resetStream(streamIds);
        return;
      }
      if (message.type === 'force-snapshot') {
        web.forceSnapshot();
      }
    },
  };
}
