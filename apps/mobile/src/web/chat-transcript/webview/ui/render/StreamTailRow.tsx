/**
 * 流式尾行结构（renderRows 全量路径）。
 * 增量 DOM 仍由 runtime/stream 负责；本步将全量壳纳入 Preact（Step 6 可迁 ui/stream）。
 */
import { h } from 'preact';
import { state } from '../../runtime/state/state';
import {
  assistantBubbleExtraClasses,
  getStreamTailPhase,
  shouldRenderStreamTail,
  streamThinkingHtml,
} from '../../runtime/stream/stream';
import { AssistantBubbleInner } from './AssistantBubble';

export function StreamTailRow() {
  if (!shouldRenderStreamTail()) return null;
  if (getStreamTailPhase() === 'waiting-first') {
    return (
      <div className="row stream stream--waiting-first" id="stream-tail">
        <div className="stream-waiting-indicator">
          <span className="tool-invoking-dot" aria-hidden="true" />
          <span className="tool-invoking-label">生成中</span>
        </div>
      </div>
    );
  }
  const showIdleBar = getStreamTailPhase() === 'idle-after-content';
  return (
    <div className="row stream" id="stream-tail">
      <div
        className={
          'bubble assistant' +
          assistantBubbleExtraClasses(
            state.stream.textHtml,
            [],
            state.stream.text,
            state.stream.thinking,
          )
        }
      >
        <AssistantBubbleInner
          text={state.stream.text}
          textHtml={state.stream.textHtml}
          thinking={state.stream.thinking}
          thinkingKey="stream:thinking"
          thinkingExpanded={true}
          thinkingHtml={streamThinkingHtml()}
          tools={[]}
          toolGroupKey="stream:tools"
          toolGroupExpanded={false}
          showToolInvoking={showIdleBar}
          richText={state.flags.richText}
        />
      </div>
    </div>
  );
}
