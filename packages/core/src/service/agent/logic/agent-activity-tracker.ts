/**
 * 进程级 Agent 运行引用计数（跨端共用；各端各自实例化一份）。
 *
 * 备份/云同步等操作须在 Agent 空闲时执行：increment / decrement 由平台层独占，
 * subscribe 供 UI 订阅运行状态。
 *
 * @module service/agent/logic/agent-activity-tracker
 */

type AgentActivityListener = (active: boolean) => void;

export class AgentActivityTracker {
    private refCount = 0;
    private readonly listeners = new Set<AgentActivityListener>();

    /** 订阅运行状态变化；返回取消订阅函数。 */
    readonly subscribe = (listener: AgentActivityListener): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** 运行开始：计数 +1，0→1 时通知订阅者。 */
    readonly increment = (): void => {
        const wasActive = this.refCount > 0;
        this.refCount += 1;
        if (!wasActive) {
            this.notify(true);
        }
    };

    /** 运行结束：计数 -1（已归零时幂等忽略），1→0 时通知订阅者。 */
    readonly decrement = (): void => {
        if (this.refCount <= 0) {
            return;
        }
        this.refCount -= 1;
        if (this.refCount === 0) {
            this.notify(false);
        }
    };

    /** 直接覆盖运行标记（迁移期兼容：true→1，false→0）；状态变化时通知。 */
    readonly setActive = (active: boolean): void => {
        const wasActive = this.refCount > 0;
        this.refCount = active ? 1 : 0;
        if (wasActive !== active) {
            this.notify(active);
        }
    };

    /** 是否正在运行。 */
    readonly isActive = (): boolean => this.refCount > 0;

    private notify(active: boolean): void {
        for (const listener of this.listeners) {
            listener(active);
        }
    }
}
