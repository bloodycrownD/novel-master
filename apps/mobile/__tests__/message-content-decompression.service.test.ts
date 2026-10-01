/**
 * message-content-decompression.service（mobile）单测：ic-19 调度去重 + stalled 处置。
 *
 * - 同一 runtime 连调两次调度只起一条循环（探针计数：core 搬运入口只被
 *   触发一次）；retry 换新 runtime 时对新连接重挂一次。
 * - 循环收手后 finally 复位登记键：同一 runtime 在旧循环结束后再调度会
 *   正常重挂（去重只挡「运行中」的重复挂载）。
 * - core 返回 stalled=true（零进展护栏拦停）时 warn 后本进程收手，不再
 *   零延迟续跑（防无界热循环）；普通 done=false（预算耗尽/守卫暂停）照旧
 *   续跑。
 *
 * 照 db-maintenance.service.test.ts 的全模块 mock 版式：真机 RN 环境难入
 * Jest，core 搬运入口与 Agent 守卫全部桩掉，时间轴走 fake timers。
 */
import {scheduleMobileMessageContentDecompress} from '@/services/message-content-decompression.service';

const mockRunDecompress = jest.fn();
const mockAgentActive = jest.fn();

jest.mock('@novel-master/core', () => ({
  runMessageContentDecompress: (...args: unknown[]) =>
    mockRunDecompress(...args),
  DEFAULT_DECOMPRESS_SYNC_BUDGET_MS: 60_000,
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

/** core 搬运一轮的结果（done 收工形态）。 */
const DONE_RESULT = {
  done: true,
  decompressedCount: 5,
  failedCount: 0,
  stalled: false,
};

describe('message-content-decompression.service 调度（ic-19）', () => {
  const runtime = {conn: {tag: 'live-1'}} as never;
  const runtime2 = {conn: {tag: 'live-2'}} as never;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRunDecompress.mockReset().mockResolvedValue(DONE_RESULT);
    mockAgentActive.mockReset().mockReturnValue(false);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('同一 runtime 连调两次调度只起一条循环（core 搬运入口只触一次）', async () => {
    scheduleMobileMessageContentDecompress(runtime);
    scheduleMobileMessageContentDecompress(runtime);

    // 过热身（3s）并让循环完整跑完（done 收工 + finally 复位落地）
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunDecompress).toHaveBeenCalledTimes(1);
    expect(mockRunDecompress).toHaveBeenCalledWith(
      runtime.conn,
      expect.objectContaining({syncBudgetMs: 60_000}),
    );
  });

  it('retry 换新 runtime 时对新连接重挂一次（第二条循环正常起跑）', async () => {
    scheduleMobileMessageContentDecompress(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunDecompress).toHaveBeenCalledTimes(1);

    scheduleMobileMessageContentDecompress(runtime2);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunDecompress).toHaveBeenCalledTimes(2);
    expect(mockRunDecompress).toHaveBeenNthCalledWith(
      2,
      runtime2.conn,
      expect.anything(),
    );
  });

  it('循环收手后 finally 复位登记键：同 runtime 再调度会重挂（去重只挡运行中）', async () => {
    scheduleMobileMessageContentDecompress(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunDecompress).toHaveBeenCalledTimes(1);

    // 旧循环已收工（登记键被 finally 复位），同一 runtime 再调度是合法重挂
    scheduleMobileMessageContentDecompress(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunDecompress).toHaveBeenCalledTimes(2);
  });

  it('stalled=true 时 warn 后本进程收手，不再续跑（防热循环）', async () => {
    mockRunDecompress.mockResolvedValue({
      done: false,
      decompressedCount: 0,
      failedCount: 0,
      stalled: true,
    });

    scheduleMobileMessageContentDecompress(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    // 充分放行：若实现误用 sleep(0) 续跑，这里会触发第二次 core 调用
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockRunDecompress).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('零进展'),
    );
  });

  it('普通 done=false（预算耗尽）照旧零延迟续跑直至 done', async () => {
    mockRunDecompress
      .mockResolvedValueOnce({
        done: false,
        decompressedCount: 100,
        failedCount: 0,
        stalled: false,
      })
      .mockResolvedValueOnce(DONE_RESULT);

    scheduleMobileMessageContentDecompress(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunDecompress).toHaveBeenCalledTimes(2);
  });
});
