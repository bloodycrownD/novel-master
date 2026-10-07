/**
 * r3-orc-1：runManualCompaction 编排单测。
 *
 * 2026-10-07 起编排不再做 token 预热（与置位同路径，详见被测模块头注释），
 * 本套件只钉编排契约：trigger 透传、三出口分发、尾巴自身抛错的兜底收口。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';

import {runManualCompaction} from '@/services/manual-compaction.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

const mockRunCompaction = jest.fn();
const mockGetHideStartDepth = jest.fn();

jest.mock('@novel-master/core/compaction', () => ({
  runCompaction: (...args: unknown[]) => mockRunCompaction(...args),
}));

function stubRuntime(): MobileNovelMasterRuntime {
  return {
    compactionConditionEvaluator: {
      getHideStartDepth: (...args: unknown[]) =>
        mockGetHideStartDepth(...args),
    },
    sessionKkv: {get: jest.fn(), set: jest.fn(), delete: jest.fn()},
    messages: {listBySession: jest.fn()},
    messageTranscriptEffects: {},
  } as unknown as MobileNovelMasterRuntime;
}

describe('runManualCompaction（r3-orc-1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHideStartDepth.mockResolvedValue(3);
    mockRunCompaction.mockResolvedValue({ok: true});
  });

  it('成功：onSucceeded 先于 onFinally，outcome 如实透传', async () => {
    const order: string[] = [];
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-ok'}, {
      onSucceeded: () => {
        order.push('succeeded');
      },
      onFinally: outcome => {
        order.push(`finally:${outcome.ok}`);
      },
    });
    expect(mockRunCompaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['succeeded', 'finally:true']);
  });

  it('T-CR7：编排层是手动入口，runCompaction 必须收到 trigger:"manual" 与压缩深度', async () => {
    // 少了 trigger，core 走默认 auto 分支**不清** `rule_snapshot` /
    // `file_cache` 两域——手动压缩后 workplace 块仍吃旧快照，新文件不进清单，
    // 且这件事在编排层没有任何报错，属于静默失效，故在此钉死。
    // 用**全等**而非 objectContaining：压缩深度 `hideStartDepth` 同样得钉住
    // （beforeEach 固定回 3），少传/误清该键时 core 会静默走默认深度。
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-manual'}, {});
    expect(mockRunCompaction).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 's-manual',
      projectId: 'p',
      hideStartDepth: 3,
      trigger: 'manual',
    });
  });

  it('压缩本体返回失败：只走 onFailed + onFinally，error 为 undefined（明确失败哨兵）', async () => {
    mockRunCompaction.mockResolvedValue({ok: false});
    const onSucceeded = jest.fn();
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-fail'}, {
      onSucceeded,
      onFailed,
      onFinally,
    });
    expect(onSucceeded).not.toHaveBeenCalled();
    // 明确失败 → error 为 undefined（调用方据此区分「没重载消息面」的抛错出口）
    expect(onFailed).toHaveBeenCalledWith(undefined);
    expect(onFinally).toHaveBeenCalledWith({ok: false, error: undefined});
  });

  it('压缩链抛错：错误原样透传给 onFailed', async () => {
    const boom = new Error('compaction boom');
    mockRunCompaction.mockRejectedValue(boom);
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-throw'}, {
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledWith(boom);
    expect(onFinally).toHaveBeenCalledWith({ok: false, error: boom});
  });

  it('getHideStartDepth 抛错：runCompaction 不被调，错误透传 onFailed', async () => {
    const boom = new Error('evaluator boom');
    mockGetHideStartDepth.mockRejectedValue(boom);
    const onFailed = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-depth'}, {
      onFailed,
    });
    expect(mockRunCompaction).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(boom);
  });

  it('成功尾巴自身抛错：补一次 onFailed；onFinally 不跑（旧码同样不跑 load()）', async () => {
    const boom = new Error('tail boom');
    const onFailed = jest.fn();
    const onFinally = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-tail'}, {
      onSucceeded: () => {
        throw boom;
      },
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledWith(boom);
    // 旧手工副本：成功分支抛错直接进 catch，`await load()` / 补发那一段被跳过。
    expect(onFinally).not.toHaveBeenCalled();
  });

  it('失败尾巴自身抛错：不连弹两条（onFailed 只被调用一次）', async () => {
    mockRunCompaction.mockResolvedValue({ok: false});
    const onFailed = jest.fn(() => {
      throw new Error('toast boom');
    });
    const onFinally = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-tailfail'}, {
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('成功尾巴抛错且兜底 onFailed 也抛错：兜底的兜底吞掉，仍不外抛', async () => {
    // 「不外抛异常」契约的最后一道出口：调用方是 void 调用，这里逃出去就是
    // unhandled rejection。
    const tailBoom = new Error('tail boom');
    const onFailed = jest.fn(() => {
      throw new Error('toast boom');
    });
    const onFinally = jest.fn();
    await runManualCompaction(stubRuntime(), {projectId: 'p', sessionId: 's-tailboom'}, {
      onSucceeded: () => {
        throw tailBoom;
      },
      onFailed,
      onFinally,
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(tailBoom);
  });
});
