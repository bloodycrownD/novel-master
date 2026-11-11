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
import {ThinkingSection} from '../render/ThinkingSection';
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
  /**
   * nm-style: keep-public — Preact 生命周期入口（框架按组件实例动态调用，
   * 静态引用恒为 0）；返回 false 保护 runtime 增量写入的 body DOM，是防 wipe 不变量。
   */
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

type StreamingMessageRowProps = {
  row: MessageRow;
};

export function StreamingMessageRow({row}: StreamingMessageRowProps) {
  const {text, thinking, textHtml, thinkingHtml, tools} = row;
  const streaming = row.status === 'streaming';
  const phase = streamRuntime.getStreamingPhase(row);
  const hiddenCls = row.hidden ? 'hidden ' : '';
  const waitCls = phase === 'waiting-first' ? ' stream--waiting-first' : '';
  // `assistant` 行类与普通 assistant 行同面（P2-9）：`.row.assistant .bubble
  // .bubble--fill-width` 等行级选择器对流式起源行同样生效。
  const outerClass = `row message ${hiddenCls}assistant stream${waitCls}`;
  // `#stream-tail` 单主（P1-1 纵深防御）：只挂 checkpoint 指向的 streaming 行，
  // 旧 step 残留的 streaming 行不得抢走 delta 的落笔点（双 id 时
  // getElementById 取文档序第一条）。checkpoint 缺省（尚无基线快照）时退化为
  // 「streaming 行即尾」，保持 shell 自身可被增量路径定位。
  const cp = state.streamCheckpoint;
  const isTail = streaming && (cp == null || cp.id === row.id);
  const tailId = isTail ? 'stream-tail' : undefined;

  if (phase === 'waiting-first') {
    return (
      <div
        className={outerClass}
        data-id={row.id}
        data-stream-id={row.id}
        data-streaming="1"
        data-stream-status={row.status}
        id={tailId}
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
  // streaming 必须展开：runtime getStreamThinkingBody 依赖 .thinking-body 存在，
  // 思考增量才有落笔点；折叠/展开只在 finished 行交给用户控制。
  const thinkingKey = streaming ? 'stream:thinking' : 'msg:' + row.id;
  const thinkingExpanded = streaming || !!state.thinkingExpanded[thinkingKey];
  const toolGroupKey = streaming ? 'stream:tools:' + row.id : 'msg:' + row.id;
  const stored = state.toolGroupExpanded[toolGroupKey];
  const groupExpanded = streaming ? stored !== false : !!stored;

  /** ⋯ 菜单入口：仅 finished 且已 DB 接管（messageId 是动作唯一落点）。 */
  const menuAllowed = !state.flags.menuDisabled;
  const showMenu = !streaming && row.messageId != null && menuAllowed;

  const bubbleExtra = streamRuntime.assistantBubbleExtraClasses(row);
  const bubbleClass = 'bubble assistant' + bubbleExtra;
  // 正文播种：rich 用全量 html，否则用明文（首次 mount 生效）。
  const textRich = !!(state.flags.richText && textHtml);
  const textClass = 'bubble-body' + (textRich ? ' rich' : '');
  // 稳定 text host：streaming 期即使正文为空也挂（runtime 首个 delta 直接落笔）；
  // finished 行按普通 assistant 行等价面挂（有正文，或仅 thinking 时空壳兜后续正文）。
  const mountTextHost = streaming || hasText || hasThinking;

  return (
    <div
      className={outerClass}
      data-id={row.id}
      data-stream-id={row.id}
      data-streaming={streaming ? '1' : undefined}
      data-stream-status={row.status}
      id={tailId}
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
        {hasThinking
          ? // 复用 ThinkingSection（P2-9 等价面，标题读 labels）：直接调用纯函数组件
            // 而不是 <ThinkingSection/>，让 header/body 留在返回的 vnode 树里
            // （T-SP11 的 data-thinking-key / thinking-body / toggle-thinking 契约
            // 依赖它们可见）。body 注入 StreamBodyHost，保住增量 DOM 岛。
            ThinkingSection({
              text: thinking,
              title: state.labels.thinking,
              thinkingKey,
              expanded: thinkingExpanded,
              thinkingHtml,
              showDividerBelow: hasText || hasTools,
              richText: state.flags.richText,
              renderBody: (bodyClass, useRich) => (
                <StreamBodyHost
                  key="stream-thinking-body"
                  className={bodyClass}
                  seedHtml={useRich ? thinkingHtml! : null}
                  seedText={useRich ? null : String(thinking || '')}
                />
              ),
            })
          : null}
        {mountTextHost ? (
          <StreamBodyHost
            key="stream-text-body"
            className={textClass}
            dataTextShell={!hasText && (hasThinking || hasTools)}
            seedHtml={textRich ? textHtml! : null}
            seedText={textRich ? null : String(text || '') || null}
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
