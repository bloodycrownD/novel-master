/**
 * vfs-content-packing.service（mobile）单测：调度去重 + 登记键收手释放
 * （fix-spec pbp-11）。
 *
 * - 同一 runtime 连调两次调度只起一条循环（探针计数：core 打包入口
 *   `runVfsContentPacking` 只被触发一次）。
 * - 循环收手（core 返回 done=true）后 finally 条件复位释放登记键：同一
 *   runtime 再调度会重新起循环（core 入口被触发第二次）——去重只挡
 *   「运行中」的重复挂载，不挡「跑完后再挂」。
 *
 * mock 面（pbp-11 r3 补）：除 core 与 Agent 守卫外，必须桩掉
 * `@/services/db-maintenance-busy`（服务 `:34` import 了它），否则真机 RN
 * 环境加载真实模块。版式照 message-content-compaction.service.test.ts 的
 * 全模块 mock：真机 RN 环境难入 Jest，时间轴走 fake timers。
 */
import {scheduleMobileVfsContentPacking} from '@/services/vfs-content-packing.service';

const mockRunPacking = jest.fn();
const mockAgentActive = jest.fn();

jest.mock('@novel-master/core', () => ({
  runVfsContentPacking: (...args: unknown[]) => mockRunPacking(...args),
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

// pbp-11 r3 补：服务 import 了维护互斥守卫，不桩掉会加载真实模块
jest.mock('@/services/db-maintenance-busy', () => ({
  isMobileDbMaintenanceBusy: () => false,
}));

/** core 打包一轮的结果（done 收手形态）。 */
const DONE_RESULT = {
  done: true,
  packedGroups: 2,
  failedGroups: 0,
  stalled: false,
};

describe('vfs-content-packing.service 调度（pbp-11）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRunPacking.mockReset().mockResolvedValue(DONE_RESULT);
    mockAgentActive.mockReset().mockReturnValue(false);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('同一 runtime 连调两次调度只起一条循环（core 打包入口只触一次）', async () => {
    const conn = {tag: 'live-1'};
    const runtime = {conn} as never;

    scheduleMobileVfsContentPacking(runtime);
    scheduleMobileVfsContentPacking(runtime);

    // 过热身（3s）并让循环完整跑完（done 收工 + finally 复位落地）
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunPacking).toHaveBeenCalledTimes(1);
    expect(mockRunPacking).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({shouldPause: expect.any(Function)}),
    );
  });

  it('循环收手后 finally 释放登记键：同 runtime 再调度会重挂（core 入口触第二次）', async () => {
    // 独立 runtime：服务模块级登记键跨用例共享，隔离掉前一条的残留键，
    // 让本例的红点精确落在「旧循环收手后的再调度」这一行为上。
    const rt = {conn: {tag: 'live-2'}} as never;

    scheduleMobileVfsContentPacking(rt);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRunPacking).toHaveBeenCalledTimes(1);

    // 旧循环已收工（登记键被 finally 复位），同一 runtime 再调度是合法重挂
    scheduleMobileVfsContentPacking(rt);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockRunPacking).toHaveBeenCalledTimes(2);
  });
});