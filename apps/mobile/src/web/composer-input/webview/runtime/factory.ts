/**
 * composer-input 装配工厂：旧包薄入口与新合成包（chat-conversation）**唯一**的装配点。
 *
 * 为什么工厂不放在 main.ts：main.ts 是旧包的构建入口（`build-webview.mjs` 的 entryRel）
 * 且带顶层副作用——ESM import 即执行，新包 import 它会双挂载/双绑定/双 ready。工厂体搬
 * 到这里后，main.ts 退化为「import + 一行调用」，新包可以只 import 工厂按需装配。
 *
 * 契约要点：
 * - **无 post 参数**：工厂直接 import `./bridge` 的模块级 post 单例，runtime 内部上行
 *   消息头 `v` 恒为本包 BRIDGE_V（不替换、不注入，合成包的 v2 ready 由入口自建 post 发）。
 * - 参数默认值 = 旧包现行为（heightReport / bindChannel / emitReady 全 true），故旧包
 *   薄入口用默认参数调用即行为零变化（宏链活依赖 composer-input 包）。
 * - 装配顺序照旧 main.ts：先挂编辑器（后续 init 直接应用）→ 再绑 host 消息通道 →
 *   最后发 ready（宿主一切下行以 ready 为门控）。
 */
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {handleHostMessage, post} from './bridge';
import {mountComposerEditor} from './editor';
import {BRIDGE_V} from './model';

export type ComposerRuntimeOptions = {
  /**
   * 高度上报开关（默认 true = 旧包行为）。
   * false 时 `post('heightChange')` 上报链关闭——measureByClamp / ResizeObserver
   * 逻辑照跑（clamp 与 lastHeight 去重不变），只是不发消息；用于高度改由文档内布局
   * 消化的场景（合成包 dock 与转录同文档，不需要跨桥高度链）。
   */
  readonly heightReport?: boolean;
  /** 是否绑定 host→web 消息通道（默认 true）。false 时由合成入口统一注册单次通道。 */
  readonly bindChannel?: boolean;
  /** 是否发 ready（默认 true）。false 时由合成入口在两 runtime 均 boot 完成后发单条 ready。 */
  readonly emitReady?: boolean;
};

export type ComposerRuntimeHandle = {
  /** 解析出的挂载点；null = host 未命中（此时只走绑定/ready，与旧 main.ts 一致）。 */
  readonly parent: HTMLElement | null;
  /** 是否真的挂载了编辑器（parent 命中即 true）。 */
  readonly mounted: boolean;
  /** 生效后的三个开关（回显，便于调用方与单测断言）。 */
  readonly heightReport: boolean;
  readonly bindChannel: boolean;
  readonly emitReady: boolean;
};

/** 挂载点解析：元素直通；选择器字符串走 querySelector（合成包挂 `#composer-input`）。 */
export function resolveComposerHost(
  host: HTMLElement | string,
): HTMLElement | null {
  if (typeof host === 'string') {
    return document.querySelector(host);
  }
  return host ?? null;
}

/**
 * 装配 composer runtime 的全部顶层副作用（挂载 / 绑通道 / 发 ready）。
 * @param host    挂载点元素或选择器；未命中时跳过挂载（不抛，与旧 main.ts 的 null 守卫同口径）
 * @param options 三个开关，缺省即旧包现行为
 */
export function createComposerRuntime(
  host: HTMLElement | string,
  options: ComposerRuntimeOptions = {},
): ComposerRuntimeHandle {
  const heightReport = options.heightReport !== false;
  const bindChannel = options.bindChannel !== false;
  const emitReady = options.emitReady !== false;

  const parent = resolveComposerHost(host);
  if (parent != null) {
    mountComposerEditor(parent, {heightReport});
  }

  if (bindChannel) {
    bindHostMessageChannel(handleHostMessage);
  }

  if (emitReady) {
    post('ready', {version: BRIDGE_V});
  }

  return {
    parent,
    mounted: parent != null,
    heightReport,
    bindChannel,
    emitReady,
  };
}
