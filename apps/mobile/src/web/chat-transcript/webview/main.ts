/**
 * chat-transcript 独立入口（esbuild → IIFE app.js；composer-native-2026-10 Step 2）。
 *
 * 转录侧从 chat-conversation 合成包拆回独立文档：本包没有 composer runtime /
 * dock / dispatcher，runtime 自绑宿主 message 通道（`bindChannel: true`——合成包
 * 传 false 是因为 dispatcher 先行单次注册；独立入口无 dispatcher，注册权交还
 * runtime）。`emitReady: false` 必须显式关：runtime 自发的 ready 是 v:1 envelope
 * （`version:'m4'`），宿主只认 `v === 2`，由本入口自包一条 v:2 ready。
 *
 * ready 形态与 chat-conversation/main.ts 的 `emitConversationReady` 同构（闸门 +
 * 单条 + DOMContentLoaded 兜底），两处差异：
 *   1. capabilities **不含** composer-dock——直接用转录域共享常量
 *      `TRANSCRIPT_CAPABILITIES`（能力协商「未声明 = 不支持」对 dock 位本来就
 *      不成立：独立入口没有 dock，缺位是预期形态）；
 *   2. version 用独立入口自己的 `t1`（`TRANSCRIPT_READY_VERSION`，与 RN 桥
 *      同源常量），日志面一眼区分 ready 来自独立入口还是合成包。
 *
 * 装配闸：壳结构（#rows 挂载点）未命中就**不发** ready，交宿主 8s 超时兜底落
 * 错误态——与合成包 shouldEmitConversationReady 的「ready 不来本身就是最有效的
 * 装配失败诊断」同一纪律。
 *
 * 上行 v 号：转录 runtime 内部的 `post` 单例仍是模块级 v:1（6+ 兄弟模块直接
 * import，不可替换）；本入口自持的 `createBoundPost(2)` **只**供 ready 使用。
 * 宿主只认 `v === 2` 的 ready，其余上行宽容解析（不校验 v）。
 *
 * es2018 纪律：web 代码禁 ES2021+ 运行时 API 与 lookbehind 正则（esbuild target es2018）。
 */
import {createBoundPost} from '@web/shared/post';
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {createTranscriptRuntime} from '@web/chat-transcript/webview/runtime/factory';
import {handleHostMessage} from '@web/chat-transcript/webview/runtime/bridge';
import {
  TRANSCRIPT_CAPABILITIES,
  TRANSCRIPT_READY_VERSION,
} from '@web/chat-transcript/transcript-capabilities';

/**
 * 独立入口下行信封桥版本。与合成包 `CONVERSATION_BRIDGE_V` 同值：宿主的
 * ready 验收只认 `v === 2`，v 号语义是「v2 协议文档」而非「某个具体包」。
 */
const TRANSCRIPT_ENTRY_BRIDGE_V = 2;

/** runtime 老桥的下行信封版本（state.BRIDGE_V，消息头 v 恒为 1）。 */
const TRANSCRIPT_RUNTIME_BRIDGE_V = 1;

// 新入口自有上行出口（v:2）：仅 ready 一条（dockAction 随 dock 退役，无此上行）。
const post = createBoundPost(TRANSCRIPT_ENTRY_BRIDGE_V);

/**
 * 下行 v2→v1 翻译层（真机实锤补上）：宿主下行全是 v2 信封，而 runtime 的
 * `handleHostMessage` 用 `matchHostMessage(raw, BRIDGE_V)` 只认 v1——合成包时代
 * 这层拆包重打包由 dispatcher 承担，dispatcher 随包退役后若 runtime 直绑通道，
 * init/快照会在 `if (!msg) return` 处被静默丢弃（白屏无错误页）。故本入口承接
 * dispatcher 的 transcript 半边：**先**单次注册宿主通道，把 v2 拆包重打包成 v1
 * 喂给 runtime；runtime 以 `bindChannel: false` 装配（不再自绑，单次注册纪律保持）。
 * 未知 type 透传给 runtime 的 switch 自行忽略（宽松口径与 dispatcher 一致）。
 */
bindHostMessageChannel(rawDowntranslate);

function rawDowntranslate(raw: unknown): void {
  let env: any = raw;
  if (typeof raw === 'string') {
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (
    env == null ||
    typeof env !== 'object' ||
    env.v !== TRANSCRIPT_ENTRY_BRIDGE_V ||
    typeof env.type !== 'string'
  ) {
    return;
  }
  handleHostMessage({
    v: TRANSCRIPT_RUNTIME_BRIDGE_V,
    type: env.type,
    payload: env.payload,
  });
}

/* ---- 转录 runtime：不自绑通道（本入口已先绑并承接 v2→v1 翻译）、ready 发言权交本入口。 ---- */
createTranscriptRuntime({bindChannel: false, emitReady: false});

/* ---- 单条 v:2 ready：壳装配成功后发；失败不发，交宿主 8s 超时兜底。 ---- */
function emitTranscriptReady(): void {
  // ready 闸门：转录装配面唯一可检的壳锚是 #rows（行列表挂载点；#menu-portal /
  // #mermaid-viewer-portal 缺失只影响菜单/全屏，不构成白屏级失败，不设闸）。
  // 壳 id 漂移时 renderRows 会静默跳过——同合成包闸门一样，此处直接返回把信号
  // 交回宿主超时兜底，「ready 不来」本身就是最有效的装配失败诊断。
  if (document.getElementById('rows') == null) {
    console.error(
      '[chat-transcript] 装配未完成，不发 ready：壳元素未命中（#rows），' +
        '交由宿主 8s 超时兜底落错误态。',
    );
    return;
  }
  post('ready', {
    version: TRANSCRIPT_READY_VERSION,
    capabilities: TRANSCRIPT_CAPABILITIES,
    readyState: document.readyState,
  });
}

if (document.readyState === 'loading') {
  // createTranscriptRuntime 内部经 startTranscriptBoot 先注册自己的 DOMContentLoaded
  // 回调（bindChannel 同步执行），本回调注册序在其后——同一次 DOMContentLoaded 里
  // boot 一定先于 ready 跑完，顺序由注册序保证，不需要模块级可变 flag。
  document.addEventListener('DOMContentLoaded', emitTranscriptReady);
} else {
  emitTranscriptReady();
}
