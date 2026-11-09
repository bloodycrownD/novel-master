/**
 * 共享 transcript ready fixture（spec §9.1 / P1-9）：v2 信封 + ready `t2` +
 * `streamProjection` 能力位。
 *
 * 旧用例各自手写 `version:'test'`/`u1`/仅 `streamBlockCommit` 的 ready 载荷，
 * 协议升级后逐文件漂移。这里单一来源：宿主判定（v===2、version t2、能力含
 * streamProjection）与 web dist 的 ready 常量同源。
 */
import type TestRenderer from 'react-test-renderer';
import {act} from 'react-test-renderer';
import {CONVERSATION_BRIDGE_V} from '@/components/chat/ChatConversationBridge';
import {
  TRANSCRIPT_CAPABILITIES,
  TRANSCRIPT_READY_VERSION,
} from '@/web/chat-transcript/transcript-capabilities';

export type TranscriptReadyEnvelope = {
  v: number;
  type: 'ready';
  payload: {
    version: string;
    capabilities: string[];
    readyState: string;
  };
};

/** 现代 ready 载荷（v2 + t2 + streamBlockCommit/streamProjection）。 */
export function makeTranscriptReadyPayload(): TranscriptReadyEnvelope {
  return {
    v: CONVERSATION_BRIDGE_V,
    type: 'ready',
    payload: {
      version: TRANSCRIPT_READY_VERSION,
      capabilities: [...TRANSCRIPT_CAPABILITIES],
      readyState: 'complete',
    },
  };
}

/** 向测试树里的 WebView 注入一条 ready（与旧用例手写形态逐字等价）。 */
export function simulateTranscriptReady(
  root: TestRenderer.ReactTestInstance,
): void {
  const webView = root.findByType(
    require('react-native-webview').default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
    }>,
  );
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {data: JSON.stringify(makeTranscriptReadyPayload())},
    });
  });
}
