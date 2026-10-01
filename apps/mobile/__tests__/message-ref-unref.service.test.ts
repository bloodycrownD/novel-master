/**
 * message-ref-unref.service（mobile）单测：调度去重 + 三类停手/续跑处置。
 *
 * - 同一 runtime 连调两次调度只起一条循环；retry 换新 runtime 时对新连接重挂
 *   一次；循环收手后 finally 复位登记键。
 * - **守卫让路**：Agent 活跃时先退避重试，守卫放开后才真正调 core。
 * - **deferred / stalled 停手**：两者都 warn 后 return，**不得 sleep(0) 续轮**
 *   （续轮会把空转放大成无界热循环；断言 core 入口只被触发一次）。
 * - **预算耗尽续跑**：普通 done=false（deferred/stalled 皆 false）照旧零延迟
 *   续跑直至 done。
 *
 * 照 message-content-decompression.service.test.ts 的全模块 mock 版式：真机
 * RN 环境难入 Jest，core 回迁入口与 Agent 守卫全部桩掉，时间轴走 fake timers。
 */
import {scheduleMobileMessageRefUnref} from '@/services/message-ref-unref.service';

const mockRunUnref = jest.fn();
const mockAgentActive = jest.fn();

jest.mock('@novel-master/core', () => ({
  runMessageRefUnref: (...args: unknown[]) => mockRunUnref(...args),
  DEFAULT_REF_UNREF_SYNC_BUDGET_MS: 60_000,
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

/** core 回迁一轮的收工形态。 */
const DONE_RESULT = {
  done: true,
  unrefedCount: 5,
  failedCount: 0,
  noRefBlockCount: 0,
  stalled: false,
  deferred: false,
};

describe('message-ref-unref.service 调度', () => {
  const runtime = {conn: {tag: 'live-1'}} as never;
  const runtime2 = {conn: {tag: 'live-2'}} as never;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRunUnref.mockReset().mockResolvedValue(DONE_RESULT);
    mockAgentActive.mockReset().mockReturnValue(false);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('同一 runtime 连调两次调度只起一条循环（core 回迁入口只触一次）', async () => {
    scheduleMobileMessageRefUnref(runtime);
    scheduleMobileMessageRefUnref(runtime);

    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunUnref).toHaveBeenCalledTimes(1);
    expect(mockRunUnref).toHaveBeenCalledWith(
      runtime.conn,
      expect.objectContaining({syncBudgetMs: 60_000}),
    );
  });

  it('retry 换新 runtime 时对新连接重挂一次', async () => {
    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunUnref).toHaveBeenCalledTimes(1);

    scheduleMobileMessageRefUnref(runtime2);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunUnref).toHaveBeenCalledTimes(2);
    expect(mockRunUnref).toHaveBeenNthCalledWith(
      2,
      runtime2.conn,
      expect.anything(),
    );
  });

  it('循环收手后 finally 复位登记键：同 runtime 再调度会重挂', async () => {
    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunUnref).toHaveBeenCalledTimes(1);

    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunUnref).toHaveBeenCalledTimes(2);
  });

  it('守卫命中时让路：Agent 活跃期间不调 core，放开后照常收敛', async () => {
    mockAgentActive.mockReturnValue(true);

    scheduleMobileMessageRefUnref(runtime);
    // 热身 3s 后仍在守卫退避里（5s 一拍），core 入口不得被触发。
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunUnref).toHaveBeenCalledTimes(0);

    mockAgentActive.mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunUnref).toHaveBeenCalledTimes(1);
    expect(mockRunUnref).toHaveBeenCalledWith(
      runtime.conn,
      expect.objectContaining({syncBudgetMs: 60_000}),
    );
  });

  it('deferred=true（解压任务未完成）时 warn 后本进程收手，不续轮', async () => {
    mockRunUnref.mockResolvedValue({
      ...DONE_RESULT,
      done: false,
      unrefedCount: 3,
      deferred: true,
    });

    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    // 充分放行：若实现误用 sleep(0) 续跑，这里会触发第二次 core 调用
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockRunUnref).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('deferred'),
    );
  });

  it('stalled=true（收尾残留校验拦停）时 warn 后本进程收手，不续轮', async () => {
    mockRunUnref.mockResolvedValue({
      ...DONE_RESULT,
      done: false,
      stalled: true,
    });

    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockRunUnref).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('零进展'),
    );
  });

  it('普通 done=false（预算耗尽）照旧零延迟续跑直至 done', async () => {
    mockRunUnref
      .mockResolvedValueOnce({
        ...DONE_RESULT,
        done: false,
        unrefedCount: 100,
      })
      .mockResolvedValueOnce(DONE_RESULT);

    scheduleMobileMessageRefUnref(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunUnref).toHaveBeenCalledTimes(2);
  });
});