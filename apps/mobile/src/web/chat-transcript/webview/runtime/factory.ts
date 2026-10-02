/**
 * chat-transcript runtime 装配工厂（chat-webview-unify Step 1）。
 *
 * 旧 `main.ts` 既是 esbuild 入口又带顶层装配副作用（ESM import 即执行），
 * 合成包若直接 import 它会双 boot / 双注册 / 双 ready，故把全部装配动作收进
 * 本工厂，`main.ts` 退化为薄入口（import 工厂 + 一行调用 + re-export）。
 *
 * 参数：
 * - `bindChannel`（默认 true = 旧包现行为）：false 时不自绑宿主 message 通道，
 *   由合成入口统一 `bindHostMessageChannel(合成 dispatcher)` 单次注册。
 * - `emitReady`（默认 true = 旧包现行为）：false 时本 runtime 不上抛 ready，
 *   由合成入口在两 runtime 均 boot 完成后发单条 v2 ready。
 *
 * 无 `post` 参数：工厂内部与旧 main.ts 同款直接 import 模块级 post 单例
 * （bridge.ts 的 createBoundPost(BRIDGE_V)，消息头 v 恒为 1），不替换 runtime
 * 内部任何东西。
 */
import {h, render} from 'preact';
import {registerRenderContextMenu} from './menu/menu';
import {registerRenderRows} from './render/row-logic';
import {measureRowWindow} from './render/row-windowing';
import {startTranscriptBoot} from './boot/boot-transcript';
import {post} from './bridge';
import {
  attachMermaidViewerDelegation,
  mountMermaidViewerPortal,
} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {MenuOverlay} from '../ui/menu/MenuOverlay';
import {RowList} from '../ui/render/RowList';

export type TranscriptRuntimeOptions = {
  /** 是否自绑宿主 message 通道（旧包默认 true；合成包传 false 由入口单次注册）。 */
  bindChannel?: boolean;
  /** 是否由本 runtime 上抛 ready（旧包默认 true；合成包传 false 由入口发单条）。 */
  emitReady?: boolean;
};

/**
 * 装配 chat-transcript runtime 的全部顶层副作用。
 * 旧包以默认参数调用 → 与拆分前 main.ts 逐行等价（行为零变化）。
 */
export function createTranscriptRuntime(
  options: TranscriptRuntimeOptions = {},
): void {
  const {bindChannel = true, emitReady = true} = options;

  const menuPortal = document.getElementById('menu-portal');

  // P0-3 / ISD：注册完整菜单 overlay；关闭时 render(null) 卸载
  registerRenderContextMenu(props => {
    if (!menuPortal) return;
    if (!props) {
      render(null, menuPortal);
      return;
    }
    render(h(MenuOverlay, props), menuPortal);
  });

  // P0-3：注册行列表 Preact 实现（消毒 HTML 经 TrustedHtml，见 ui/render）
  registerRenderRows(() => {
    const list = document.getElementById('rows');
    if (!list) return;
    render(h(RowList, null), list);
    // 窗口化（Step 7）：渲染后实测窗口行占高 → 收敛平均槽高估算
    // （窗口未变时内部跳过，流式期高频 renderRows 不产生额外 reflow）。
    measureRowWindow();
  });

  // Mermaid 全屏查看器：模块刈处一行挂接（不进 renderRows 链路）
  mountMermaidViewerPortal('mermaid-viewer-portal');
  attachMermaidViewerDelegation(post);

  startTranscriptBoot({bindChannel, emitReady});
}
