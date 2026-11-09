/**
 * 流式行壳（spec §3.3 / C26）：行自带 `status`，streaming / finished 共用同一
 * 组件类型（Preact 同 id 复用壳，status 翻转只重渲 props：bar 消失、菜单行出现、
 * 折叠键从 stream:* 切到 msg:*），不按 status 换组件。
 *
 * 数据面（spec I1/I2）：正文/思考来自行内完整 `text/thinking/textHtml/thinkingHtml`，
 * 不再有 `state.stream` 第二套投影。窗口外卸载后重建时 StreamBodyHost 从行内
 * 完整文本播种（不是尾块），块级已提交内容不丢。
 *
 * 防 wipe：StreamBodyHost.shouldComponentUpdate === false，壳 re-render（相位条、
 * bubble class、折叠键）不得销毁 runtime 增量写入的 body DOM；richText 开→关时
 * 由 `state.plainReseedStreamId` 显式触发一次 body 纯文本重播。
 *
 * waiting-first（status streaming 且 text/thinking/tools 全空）：只渲染行 + 等待
 * 指示条，不渲染 `.bubble`；首个 delta 由 runtime `renderRows` 建完整壳（含稳定
 * 空 `.bubble-body`），runtime 永远命中 Preact 已挂的 body。
 *
 * E2 allowlist：本文件（含 StreamBodyHost）可值导入 `state`；
 * 新 ui 组件禁直读——见 apps/mobile/README.md「E2：ui 禁值导入 state」。
 */
import {Component} from 'preact';
import type {ComponentChildren} from 'preact';
import {TrustedHtml} from '@web/shared/ui/TrustedHtml';
import * as streamRuntime from '../../runtime/stream/stream';
import {state} from '../../runtime/state/state';
import type {MessageRow} from '../../runtime/state/state';
import {openContextMenuFromAnchor} from '../../runtime/menu/menu';
import {ToolInvokingBar} from '../render/ToolInvokingBar';
import {CollapsibleHeader} from '../render/CollapsibleSection';
import {ToolGroup} from '../render/ToolGroup';

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
    const {className, dataTextShell, seedHtml, seedText} = this.props;
    const shellAttr = dataTextShell ? {'data-text-shell': '1' as const} : {};
    if (seedHtml) {
      return (
        <TrustedHtml html={seedHtml} className={className} {...shellAttr} />
      );
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

type BodySeed = {
  seedHtml: string | null;
  seedText: string | null;
  rich: boolean;
};

/** 正文/思考 body 播种：rich 用全量 html，否则用明文（首次 mount 生效）。 */
function bodySeed(html: string | null | undefined, text: unknown): BodySeed {
  const rich = !!(state.flags.richText && html);
  if (rich) return {seedHtml: html!, seedText: null, rich};
  const value = String(text || '');
  return {seedHtml: null, seedText: value.length > 0 ? value : null, rich};
}

export type StreamingMessageRowProps = {
  row: MessageRow;
};

export function StreamingMessageRow({row}: StreamingMessageRowProps) {
  const {text, thinking, textHtml, thinkingHtml, tools} = row;
  const streaming = row.status === 'streaming';
  const phase = streamRuntime.getStreamingPhase(row);
  const hiddenClass = row.hidden ? 'hidden ' : '';
  const waiting = phase === 'waiting-first';
  const waitingClass = waiting ? ' stream--waiting-first' : '';
  const outerClass = 'row message ' + hiddenClass + 'stream' + waitingClass;

  if (phase === 'waiting-first') {
    return (
      <div
        className={outerClass}
        data-id={row.id}
        data-stream-id={row.id}
        data-streaming="1"
        data-stream-status={row.status}
        id="stream-tail"
      >
        <div className="stream-waiting-indicator">
          <span className="tool-invoking-dot" aria-hidden="true" />
          <span className="tool-invoking-label">{state.labels.generating}</span>
        </div>
      </div>
    );
  }

  // richText 从开→关的 body 重播（P2-3）：plan 置 `plainReseedStreamId` 后本次
  // 壳重渲把 sCU=false 的 body 显式改写为 row.text 纯文本；仅当前 streaming 行、
  // 仅 plain 模式消费，写入后清空（rich 再开时不会把全量 html 洗成纯文本）。
  const reseedId = state.plainReseedStreamId;
  if (
    streaming &&
    !state.flags.richText &&
    reseedId === row.id &&
    typeof document !== 'undefined'
  ) {
    const rowEl = document.getElementById('stream-tail');
    if (rowEl != null && rowEl.getAttribute('data-id') === row.id) {
      const body = rowEl.querySelector('.bubble-body');
      if (body != null) {
        body.textContent = String(text || '');
        body.classList.remove('rich');
        state.plainReseedStreamId = null;
      }
    }
  }

  const hasThinking = !!(thinking && String(thinking).trim());
  const hasText = !!(text && String(text).trim());
  const hasTools = !!(tools && tools.length > 0);
  // 折叠键（P1-6）：streaming 用 stream:* 常量键；finished 用 msg:<id> 并读
  // state.thinkingExpanded / toolGroupExpanded（窗口卸载重建后展开态保持）。
  const thinkingKey = streaming ? 'stream:thinking' : 'msg:' + row.id;
  const thinkingExpanded = !streaming && !!state.thinkingExpanded[thinkingKey];
  const toolGroupKey = streaming ? 'stream:tools:' + row.id : 'msg:' + row.id;
  const stored = state.toolGroupExpanded[toolGroupKey];
  const groupExpanded = streaming ? stored !== false : !!stored;

  /** ⋯ 菜单入口：仅 finished 且已 DB 接管（messageId 是动作唯一落点）。 */
  const menuAllowed = !state.flags.menuDisabled;
  const showMenu = !streaming && row.messageId != null && menuAllowed;

  const bubbleExtra = streamRuntime.assistantBubbleExtraClasses(row);
  const bubbleClass = 'bubble assistant' + bubbleExtra;
  const thinkSeed = hasThinking ? bodySeed(thinkingHtml, thinking) : null;
  const showDivided = thinkingExpanded && (hasText || hasTools);
  const divided = showDivided ? ' thinking-body-divided' : '';
  const thinkingRich = thinkSeed?.rich ? ' rich' : '';
  const thinkingClass = 'thinking-body' + thinkingRich + divided;
  const textSeed = bodySeed(textHtml, text);
  const textClass = 'bubble-body' + (textSeed.rich ? ' rich' : '');
  // streaming-content 时即使正文为空也挂稳定 text host；finished 静态行只在有正文时挂。
  const mountTextHost = streaming ? true : hasText;

  return (
    <div
      className={outerClass}
      data-id={row.id}
      data-stream-id={row.id}
      data-streaming={streaming ? '1' : undefined}
      data-stream-status={row.status}
      id={streaming ? 'stream-tail' : undefined}
    >
      <div className={bubbleClass}>
        {showMenu ? (
          <div className="message-menu-row">
            <span className="message-role-label">助手</span>
            <button
              type="button"
              className="message-menu-btn"
              aria-label="消息操作"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                const btn = event.currentTarget as HTMLButtonElement | null;
                if (!btn || typeof btn.getBoundingClientRect !== 'function') {
                  return;
                }
                const anchor = btn.getBoundingClientRect();
                openContextMenuFromAnchor(row.messageId ?? row.id, anchor, btn);
              }}
            >
              ⋯
            </button>
          </div>
        ) : null}
        {hasThinking && thinkSeed ? (
          <div
            key="stream-thinking"
            className="thinking-section"
            data-thinking-key={thinkingKey}
          >
            <CollapsibleHeader
              headerClass="thinking-header"
              title={state.labels.thinking}
              action="toggle-thinking"
              dataKey="thinking-key"
              dataValue={thinkingKey}
              expanded={thinkingExpanded}
            />
            {thinkingExpanded ? (
              <StreamBodyHost
                key="stream-thinking-body"
                className={thinkingClass}
                seedHtml={thinkSeed.seedHtml}
                seedText={thinkSeed.seedText}
              />
            ) : null}
          </div>
        ) : null}
        {mountTextHost ? (
          <StreamBodyHost
            key="stream-text-body"
            className={textClass}
            dataTextShell={!hasText && (hasThinking || hasTools)}
            seedHtml={textSeed.seedHtml}
            seedText={textSeed.seedText}
          />
        ) : null}
        {hasTools ? (
          <ToolGroup
            key="stream-tool-group"
            tools={tools!}
            groupKey={toolGroupKey}
            expanded={groupExpanded}
            showDividerBelow={false}
          />
        ) : null}
        {/* tool-invoking 单路径：仅 streaming 行声明式产出（finished 无指示条） */}
        {streaming ? (
          <ToolInvokingBar
            key="stream-invoking"
            label={state.labels.generating}
          />
        ) : null}
      </div>
    </div>
  );
}
