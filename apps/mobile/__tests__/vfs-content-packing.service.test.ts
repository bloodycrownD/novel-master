/**
 * vfs-content-packing.service（mobile）单测：调度去重 + 登记键收手释放
 * （fix-spec pbp-11）与调度契约（fix-spec pbp-29）。
 *
 * - 同一 runtime 连调两次调度只起一条循环（探针计数：core 打包入口
 *   `runVfsContentPacking` 只被触发一次）。
 * - 循环收手（core 返回 done=true）后 finally 条件复位释放登记键：同一
 *   runtime 再调度会重新起循环（core 入口被触发第二次）——去重只挡
 *   「运行中」的重复挂载，不挡「跑完后再挂」。
 * - pbp-29 契约三条（照 blob 归一 / 消息压缩的调度契约先例）：
 *   ① `stalled=true` → warn 后本进程收手，core 入口只被调一次（删掉服务里
 *      的 stalled 分支，本例必红——会退化成 sleep(0) 无界热循环）；
 *   ② 守卫组合 source 契约：循环顶 + shouldPause 两处消费
 *      `isMobileAgentActive() || isMobileDbMaintenanceBusy()` 双条件；
 *   ③ `done=true` 收工：core 入口只被调一次、不打任何收手告警。
 *
 * mock 面（pbp-11 r3 补）：除 core 与 Agent 守卫外，必须桩掉
 * `@/services/db-maintenance-busy`（服务 `:34` import 了它），否则真机 RN
 * 环境加载真实模块。版式照 message-content-compaction.service.test.ts 的
 * 全模块 mock：真机 RN 环境难入 Jest，时间轴走 fake timers。
 */
import {readFileSync} from 'fs';
import {join} from 'path';
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

const serviceSource = readFileSync(
  join(__dirname, '../src/services/vfs-content-packing.service.ts'),
  'utf8',
);

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

/**
 * pbp-29 调度契约：stalled 收手 / 守卫组合 source 契约 / done 收工。
 *
 * 与上面 pbp-11 的两条分块：pbp-11 钉「登记键生命周期」，本块钉「循环对 core
 * 三种返回值的处置口径」——这两块合起来才覆盖服务里逐字复制来的高风险分支。
 */
describe('vfs-content-packing.service 调度契约（pbp-29）', () => {
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

  it('stalled=true 时 warn 后本进程收手，不再续跑（core 入口只触一次）', async () => {
    // 独立 runtime：模块级登记键按对象身份去重，跨用例不互相挡
    const runtime = {conn: {tag: 'live-stalled'}} as never;
    mockRunPacking.mockResolvedValue({
      done: false,
      packedGroups: 0,
      failedGroups: 0,
      stalled: true,
    });

    scheduleMobileVfsContentPacking(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    // 充分放行：删掉 stalled 分支的实现会退化成 sleep(0) 续跑，这里
    // 会看到第二次（乃至更多次）core 调用 → 红。
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockRunPacking).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('未收敛'),
    );
  });

  it('done=true 时收工返回：core 入口只触一次且不打收手告警', async () => {
    const runtime = {conn: {tag: 'live-done'}} as never;
    mockRunPacking.mockResolvedValue(DONE_RESULT);

    scheduleMobileVfsContentPacking(runtime);
    await jest.advanceTimersByTimeAsync(3_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(mockRunPacking).toHaveBeenCalledTimes(1);
    // done 收工是正常形态，不该有任何 warn（warn 出现在 stalled / 抛错路径）
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('source 契约：守卫组合含 Agent + busy 双条件，且循环顶与 shouldPause 两处消费', () => {
    // 组合函数体含两条件（去掉空白后匹配）；「两处消费」以组合函数的
    // 消费次数钉住（循环顶 if + shouldPause 传参），缺任一条件都会让
    // 「数据清理 VACUUM 期间逐组短事务抢连接」回归。
    const normalized = serviceSource.replace(/\s+/g, '');
    expect(normalized).toContain(
      'functionmobilePackingBlocked():boolean{returnisMobileAgentActive()||isMobileDbMaintenanceBusy();}',
    );
    expect(normalized).toContain('if(mobilePackingBlocked()){');
    expect(normalized).toContain('shouldPause:mobilePackingBlocked,');
    expect(serviceSource).toMatch(/from '\.\/db-maintenance-busy'/);
  });
});