/**
 * 进程内同步类型化事件总线（纯运行时原语，无平台资源）。
 *
 * @module common/events
 */

type EventHandler<T = unknown> = (payload: T) => void;

export interface EventSubscription {
    unsubscribe(): void;
}

/** 同步 handler 抛错时的回调（可选）。 */
interface SimpleEventBusOptions {
    /** handler 同步抛错时调用；默认 console.error 兜底告警（common 不依赖 infra/log，需要接 logger 的装配点注入本回调） */
    readonly onHandlerError?: (eventType: string, error: unknown) => void;
}

/** 单进程同步 publish/subscribe 总线。 */
export class SimpleEventBus {
    private readonly handlers = new Map<string, Set<EventHandler>>();
    private readonly onHandlerError: (eventType: string, error: unknown) => void;

    constructor(options?: SimpleEventBusOptions) {
        this.onHandlerError = options?.onHandlerError ?? ((eventType, err) => console.error("[events.bus] handler failed:", eventType, err));
    }

    /** 注册 handler，返回用于取消订阅的对象。 */
    subscribe<T>(eventType: string, handler: EventHandler<T>): EventSubscription {
        let set = this.handlers.get(eventType);
        if (set == null) {
            set = new Set();
            this.handlers.set(eventType, set);
        }
        set.add(handler as EventHandler);
        return {
            unsubscribe: () => {
                set!.delete(handler as EventHandler);
                if (set!.size === 0) {
                    this.handlers.delete(eventType);
                }
            },
        };
    }

    /** 按注册顺序同步调用该事件类型的全部 handler。 */
    publish<T>(eventType: string, payload: T): void {
        const set = this.handlers.get(eventType);
        if (set == null) {
            return;
        }
        for (const handler of set) {
            try {
                handler(payload);
            } catch (err) {
                this.onHandlerError(eventType, err);
            }
        }
    }

    /** 移除全部 handler（测试用）。 */
    clear(): void {
        this.handlers.clear();
    }
}

// nm-style: keep-public — @novel-master/core/events 子入口再导出的公共类型契约（无生产直引）
export type EventBus = SimpleEventBus;
