import {state, BRIDGE_V, type TranscriptFlags} from './state/state';
import {Snapshot} from './render/snapshot';
import {Stream, type StreamDeltaPayload, type StreamStatusPayload} from './stream/stream';
import {StreamRichUpgrade} from './stream/stream-markdown';
import {Menu} from './menu/menu';
import {MermaidFullscreen} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {Post} from '@web/shared/post';
import {HostMessageChannel} from '@web/shared/host-message-channel';
import {HostTheme} from '@web/shared/host-theme';
import {RowLogic} from './render/row-logic';
import {Labels} from '../ui/labels';

// HostTheme 超集与条件式写入统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme} from '@web/shared/host-theme';

/**
 * RN 桥：postMessage 经 shared 工厂绑定 BRIDGE_V（消息头 v:1 不变）。
 */
export const post = Post.bound(BRIDGE_V);

// 可见性上报：RN 侧据此在「隐藏期间有改画推送」时强制重挂 WebView，
// 规避 Android WebView 恢复显示后仍渲染摘除前的旧帧（生成中残留的根因）。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    post('visibility', {hidden: document.hidden});
  });
}

export const Bridge = {
  handleHostMessage: (raw: unknown): void => {
    const msg = HostMessageChannel.match(raw, BRIDGE_V);
    if (!msg) return;
    const p = (msg.payload || {}) as Record<string, any>;
    switch (msg.type) {
      case 'init':
        HostTheme.apply(p.theme);
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
        }
        // labels：宿主经 core i18n 下发；旧宿主/缺省/非法值回退默认中文（C30）。
        state.labels = Labels.resolve(p.labels);
        break;
      case 'sessionSnapshot':
        // 分片协议统一入口：单片等价旧 applySnapshot 直发；多片按代次拼装，
        // 末片到齐才整体应用（rows + streamCheckpoint 原子替换）。
        Snapshot.handlePayload(p);
        break;
      case 'prependPage':
        Snapshot.applyPrependPage(p);
        break;
      case 'appendTailRows':
        Snapshot.applyAppendTailRows(p);
        break;
      case 'streamDelta':
        Stream.applyDelta(p as StreamDeltaPayload);
        break;
      case 'streamBlockCommit':
        // 块提交：完成块 append-only，不触发 mermaid（懒加载只在历史/快照路径）
        Stream.applyBlockCommit(p);
        break;
      case 'streamStatus':
        Stream.applyStatus(p as StreamStatusPayload);
        break;
      case 'streamReset': {
        // 先作废在途分片（旧代次末片不得复活被清掉的行），再清流。
        const generation = p.generation >= 0 ? p.generation : 0;
        StreamRichUpgrade.clear();
        Stream.resetBlockRenderState();
        Snapshot.invalidatePipeline(generation);
        Stream.applyReset(p);
        break;
      }
      case 'flagsUpdate':
        if (p.flags) {
          const nextFlags: TranscriptFlags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
          const richSame = state.flags.richText === nextFlags.richText;
          const menuSame = state.flags.menuDisabled === nextFlags.menuDisabled;
          if (richSame && menuSame) {
            break;
          }
          const richToggledOn = !state.flags.richText && nextFlags.richText;
          const richToggledOff = state.flags.richText && !nextFlags.richText;
          state.flags = nextFlags;
          if (state.flags.menuDisabled) {
            Menu.close(true);
          }
          if (richToggledOn) {
            // rich 关→开：下一次快照强制 reseed streaming body（P2-7）。
            state.lastStreamHtmlStreamId = null;
            state.plainReseedStreamId = null;
          } else if (richToggledOff) {
            // rich 开→关：让 StreamingMessageRow 把 body 重写为 row.text 纯文本
            // （否则 plain 增量会把转义文本追加进仍是 markdown HTML 的 body，P2-3）。
            state.plainReseedStreamId = Stream.currentRow()?.id ?? null;
            RowLogic.render();
          } else {
            RowLogic.render();
          }
        }
        break;
      case 'themeUpdate':
        HostTheme.apply(p.theme);
        break;
      case 'closeMenu':
        Menu.close(true);
        break;
      // Android 返回键：RN 拦截后下发关闭；关闭后回发 mermaidViewerClosed 复位 RN 态
      case 'closeMermaidViewer':
        MermaidFullscreen.close(true);
        break;
      default:
        break;
    }
  },
} as const;
