/**
 * 流式尾壳（P0-2）：Preact 只拥有外层相位与空/初值挂载点；
 * text / thinking body 子树由 runtime/stream 增量写入。
 *
 * 防 wipe：StreamBodyHost.shouldComponentUpdate === false，
 * 壳 re-render（相位条、bubble class）不得销毁 runtime 已写入的 body DOM。
 * 稳定 key 保证 thinking 段插入时 text host 不 remount。
 */
import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { TrustedHtml } from '@web/shared/ui/TrustedHtml';
import { state } from '../../runtime/state/state';
import {
  assistantBubbleExtraClasses,
  getStreamTailPhase,
  shouldRenderStreamTail,
  streamThinkingHtml,
} from '../../runtime/stream/stream';
import { ToolInvokingBar } from '../render/ToolInvokingBar';

type StreamBodyHostProps = {
  className: string;
  /** 稳定 data-*；仅首次 mount 生效 */
  dataTextShell?: boolean;
  /** 宿主已消毒 HTML：经 TrustedHtml；仅首次 mount */
  seedHtml?: string | null;
  /** 明文：Preact text children；仅首次 mount */
  seedText?: string | null;
};

/**
 * 命令式岛屿：首次渲染后永久跳过 diff，保护 runtime 增量 DOM。
 */
class StreamBodyHost extends Component<StreamBodyHostProps> {
  shouldComponentUpdate(): boolean {
    return false;
  }

  render(): ComponentChildren {
    const { className, dataTextShell, seedHtml, seedText } = this.props;
    const shellAttr = dataTextShell ? { 'data-text-shell': '1' as const } : {};
    if (seedHtml) {
      return <TrustedHtml html={seedHtml} className={className} {...shellAttr} />;
    }
    if (seedText) {
      return (
        <div className={className} {...shellAttr}>
          {seedText}
        </div>
      );
    }
    return <div className={className} {...shellAttr} />;
  }
}

function streamTextSeed(): { seedHtml: string | null; seedText: string | null; className: string } {
  const hasText = !!(state.stream.text && String(state.stream.text).trim());
  const textHtml = state.stream.textHtml;
  const useRich = !!(state.flags.richText && textHtml);
  if (useRich) {
    return { seedHtml: textHtml!, seedText: null, className: 'bubble-body rich' };
  }
  if (hasText) {
    return {
      seedHtml: null,
      seedText: String(state.stream.text),
      className: 'bubble-body',
    };
  }
  return {
    seedHtml: null,
    seedText: null,
    className: 'bubble-body',
  };
}

function streamThinkingSeed(): {
  seedHtml: string | null;
  seedText: string | null;
  className: string;
} {
  const thinkingHtml = streamThinkingHtml();
  const useRich = !!(state.flags.richText && thinkingHtml);
  const hasText = !!(state.stream.text && String(state.stream.text).trim());
  const showIdleBar = getStreamTailPhase() === 'idle-after-content';
  let className = 'thinking-body' + (useRich ? ' rich' : '');
  if (hasText || showIdleBar) {
    className += ' thinking-body-divided';
  }
  if (useRich) {
    return { seedHtml: thinkingHtml!, seedText: null, className };
  }
  return {
    seedHtml: null,
    seedText: String(state.stream.thinking || ''),
    className,
  };
}

export function StreamTail() {
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
  const hasThinking = !!(
    state.stream.thinking && String(state.stream.thinking).trim()
  );
  const hasText = !!(state.stream.text && String(state.stream.text).trim());
  const bubbleClass =
    'bubble assistant' +
    assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
    );

  const textSeed = streamTextSeed();
  // 仅有 thinking、或已有正文：始终挂稳定 text host，供增量 ensureStreamTextBody
  const mountTextHost = hasText || hasThinking;
  const thinkingSeed = hasThinking ? streamThinkingSeed() : null;

  return (
    <div className="row stream" id="stream-tail">
      <div className={bubbleClass}>
        {hasThinking && thinkingSeed ? (
          <div
            key="stream-thinking"
            className="thinking-section"
            data-thinking-key="stream:thinking"
          >
            <div
              className="thinking-header"
              data-action="toggle-thinking"
              data-thinking-key="stream:thinking"
            >
              <span className="thinking-title">思考过程</span>
              <span className="thinking-chevron">▼</span>
            </div>
            <StreamBodyHost
              key="stream-thinking-body"
              className={thinkingSeed.className}
              seedHtml={thinkingSeed.seedHtml}
              seedText={thinkingSeed.seedText}
            />
          </div>
        ) : null}
        {mountTextHost ? (
          <StreamBodyHost
            key="stream-text-body"
            className={textSeed.className}
            dataTextShell={!hasText && hasThinking}
            seedHtml={textSeed.seedHtml}
            seedText={textSeed.seedText}
          />
        ) : null}
        {showIdleBar ? <ToolInvokingBar key="stream-invoking" /> : null}
      </div>
    </div>
  );
}
