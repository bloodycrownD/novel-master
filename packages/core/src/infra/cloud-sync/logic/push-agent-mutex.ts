/**
 * 进程内 push/agent 互斥锁（session 维度）。
 *
 * 为什么要这把锁：cloud-sync 的 push 流程会把整库导出成快照再上传，
 * 期间如果本机 agent 启动并写入数据库，快照和后续写入就会对不上。
 * 之前 coordinator 只在 push 入口采样一次 `isAgentActive`，整个上传过程
 * 不再复检，agent 抢跑就静默拿到脏数据。这里加一把进程内互斥锁，让
 * push 和 agent 启动入口排队等对方，超时再降级拒绝，避免死等。
 *
 * 锁是进程内的、session 维度——不解决多设备争用（那是云端 lease 的事），
 * 只协调「同一进程内 push 和 agent 不能并行」。
 *
 * @module infra/cloud-sync/logic/push-agent-mutex
 */

/** 锁句柄；release 时必须传回同一实例（id 匹配）才生效。 */
export type PushAgentLockHandle = {
  readonly id: number;
  readonly acquiredAt: number;
};

export type PushAgentMutexAcquireOptions = {
  /** 排队等待的最长时间；超时抛 {@link PushAgentMutexAcquireError}。 */
  timeoutMs: number;
};

export type PushAgentMutexAcquireErrorCode = "TIMEOUT";

/** acquire 超时时抛出；调用方可据此降级拒绝（如返回 AGENT_BUSY）。 */
export class PushAgentMutexAcquireError extends Error {
  readonly code: PushAgentMutexAcquireErrorCode;
  declare readonly cause?: unknown;

  constructor(
    code: PushAgentMutexAcquireErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = "PushAgentMutexAcquireError";
    this.code = code;
  }
}

type Waiter = {
  resolve: (handle: PushAgentLockHandle) => void;
  reject: (error: PushAgentMutexAcquireError) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * 简单的进程内 FIFO 互斥锁。
 *
 * - `acquire({ timeoutMs })`：空闲时立即拿到；否则排队，超时抛 TIMEOUT。
 * - `release(handle)`：只能由当前持锁者释放；释放后唤醒队首。
 * - 重复 release、非持锁者 release 都安全忽略，避免 agent 早退兜底路径双释放。
 */
export class PushAgentMutex {
  private heldBy: PushAgentLockHandle | null = null;
  private nextId = 1;
  private readonly waiters: Waiter[] = [];

  /** 当前是否被持有（调试/状态查询用）。 */
  isHeld(): boolean {
    return this.heldBy != null;
  }

  /** 当前排队等待者数量（调试/监控用）。 */
  waiterCount(): number {
    return this.waiters.length;
  }

  /**
   * 申请锁。空闲时立即返回；否则进入 FIFO 等待队列，
   * 在 `timeoutMs` 内被唤醒则拿到锁，超时则从队列移除并抛 TIMEOUT。
   */
  async acquire(
    options: PushAgentMutexAcquireOptions
  ): Promise<PushAgentLockHandle> {
    if (this.heldBy == null) {
      const handle = this.createHandle();
      this.heldBy = handle;
      return handle;
    }

    return new Promise<PushAgentLockHandle>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
          reject(
            new PushAgentMutexAcquireError(
              "TIMEOUT",
              "等待 push/agent 互斥锁超时"
            )
          );
        }
      }, options.timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /**
   * 释放锁。仅当前持锁者（id 匹配）释放才生效；
   * 释放后把锁移交给队首等待者，没有等待者则置空。
   */
  release(handle: PushAgentLockHandle): void {
    if (this.heldBy?.id !== handle.id) {
      // 非持锁者或已释放过——agent 早退兜底路径可能双释放，安全忽略
      return;
    }

    const next = this.waiters.shift();
    if (next != null) {
      if (next.timer != null) {
        clearTimeout(next.timer);
      }
      const granted = this.createHandle();
      this.heldBy = granted;
      next.resolve(granted);
      return;
    }

    this.heldBy = null;
  }

  private createHandle(): PushAgentLockHandle {
    return { id: this.nextId++, acquiredAt: Date.now() };
  }
}
