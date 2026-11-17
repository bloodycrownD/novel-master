/**
 * renderer 事件转发工厂：把「target 解析器 + 订阅生命周期 + 单次 notify」收成
 * 一个带闭包状态的转发器，六个 IPC 通道共用同一份实现。
 *
 * 六个通道原先是六份同构文件，每个文件各自持有 target resolver 与 detach
 * 句柄；差异只在「订阅来源」：三条推送通道没有订阅，agent activity 订阅
 * refcount 变化，event bus 订阅八类 run/stream 事件。差异用 {@link EventForwarderOptions.subscribe}
 * 表达，target 存储与 detach 语义保持原样（重复 attach 先解旧订阅、返回的
 * cleanup 幂等）。
 *
 * @module ipc/event-forwarder
 */
import type { WebContents } from "electron";

/** 窗口解析器：每次发送时现取，窗口重建 / 聚焦切换无需重新注册。 */
export type ForwardTargetResolver = () => WebContents | undefined;

export interface EventForwarder<Payload, AttachArgs extends unknown[] = []> {
  /** 注册 renderer webContents 解析器。 */
  setTarget(resolver: ForwardTargetResolver): void;
  /** 挂订阅并返回 cleanup；重复 attach 先解掉旧订阅。 */
  attach(...args: AttachArgs): () => void;
  /** 单次推送（调用点已持有载荷，不走订阅）。 */
  notify(payload: Payload): void;
}

export interface EventForwarderOptions<Payload, AttachArgs extends unknown[]> {
  /**
   * 订阅来源：`emit` 收到的就是通道载荷（envelope / 投影对象由订阅方组装）。
   * 返回值必须解除本订阅；缺省表示该通道只支持 {@link EventForwarder.notify}。
   */
  readonly subscribe?: (emit: (payload: Payload) => void, ...args: AttachArgs) => () => void;
}

export function createEventForwarder<Payload, AttachArgs extends unknown[] = []>(
  channelName: string,
  options: EventForwarderOptions<Payload, AttachArgs> = {},
): EventForwarder<Payload, AttachArgs> {
  let getTarget: ForwardTargetResolver | undefined;
  let detach: (() => void) | undefined;

  const detachCurrent = (): void => {
    detach?.();
    detach = undefined;
  };

  return {
    setTarget(resolver) {
      getTarget = resolver;
    },

    attach(...args) {
      detachCurrent();
      detach = options.subscribe?.((payload) => getTarget?.()?.send(channelName, payload), ...args) ?? (() => undefined);
      return detachCurrent;
    },

    notify(payload) {
      getTarget?.()?.send(channelName, payload);
    },
  };
}
