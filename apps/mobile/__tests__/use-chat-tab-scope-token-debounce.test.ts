/**
 * message-token-cache Step 4 / T-TC6：refreshChatTokenLabel 防抖守护。
 *
 * hook 读口已套 300ms trailing debounce + 同 key 在途复用（useChatTabScope 内
 * 单槽状态机，与 desktop service 层同款语义）。本套件用 jest 假计时器钉住：
 * - rapid 双触发（间隔 <300ms）合并为一次 service 调用；
 * - 并发 5 触发在途合并为一次 service 调用；
 * - trailing 语义：窗口内不执行、窗口过后必有最终一次计算、不吞任何一击；
 * - 计算在途时新触发复用在途（不并发第二轮），随后追赶轮保证新数据最终被算。
 * - 两道前置冻结闸：run 在途（abortRegistry.has，有标签可保才冻）与压缩预热
 *   在途（isChatTokenPreciseWarmInflight，命中即不排程）。
 *
 * 只 mock runtime 与 meta/token 服务；被测 hook 用真实实现。meta 查询全程
 * 挂起（refreshChatMeta 停在 getCurrentModelId），排除挂载链对 token 标签
 * 触发次数的干扰，断言面只剩手动触发的 refreshChatTokenLabel。
 */
import {beforeEach, afterEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';
import {loadChatAgentMeta} from '../src/services/chat-agent-meta';
import {
  isChatTokenPreciseWarmInflight,
  loadChatPromptTokenLabelResilient,
} from '../src/services/chat-prompt-tokens.service';

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => '1K tokens · 预估'),
  isChatTokenPreciseWarmInflight: jest.fn(() => false),
}));

const loadChatAgentMetaMock = loadChatAgentMeta as jest.Mock;
const loadLabelMock = loadChatPromptTokenLabelResilient as jest.Mock;
const warmInflightMock = isChatTokenPreciseWarmInflight as jest.Mock;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

type Deferred<T> = ReturnType<typeof createDeferred<T>>;

async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/**
 * 挂载真实 hook；默认 runtime 的 getCurrentModelId 与 loadChatAgentMeta 都
 * 挂起（refreshChatMeta 永远停在半路），token 标签只能由测试手动触发。
 * `modelId` 传入时放行 getCurrentModelId（meta 可完整落地，供断言
 * tokenLabel 写入面——B-1 场景①回归用）。sessionId 走可变持有者：
 * 场景①回归要在挂载后切会话重渲染。`abortHas` 传入时接到 runtime 的
 * abortRegistry.has（run 在途冻结用例的控制面）。
 */
async function mountScopeHarness(options?: {
  modelId?: string;
  abortHas?: () => boolean;
}) {
  const runtime: any = {
    projects: {
      list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
      get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    },
    sessions: {listByProject: jest.fn(async () => [])},
    state: {
      getCurrentModelId:
        options?.modelId != null
          ? jest.fn(async () => options.modelId)
          : jest.fn(() => createDeferred<string>().promise),
    },
    abortRegistry: {
      has: jest.fn(options?.abortHas ?? (() => false)),
    },
    sessionVfs: jest.fn(() => ({})),
    workplace: jest.fn(() => ({})),
    projectVfs: jest.fn(() => ({})),
  };
  const sessionHolder = {sessionId: 's1'};
  let api: ReturnType<typeof useChatTabScope> | undefined;
  const Harness = () => {
    api = useChatTabScope({
      runtime,
      projectId: 'p1',
      sessionId: sessionHolder.sessionId,
      setCurrentProject: jest.fn(async () => undefined),
      setCurrentSession: jest.fn(async () => undefined),
      refreshScope: jest.fn(async () => undefined),
      showToast: jest.fn(),
      navigation: {navigate: jest.fn()} as any,
    });
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness));
    await flushMicrotasks();
  });
  return {
    api: () => api!,
    setSessionId: (sessionId: string) => {
      sessionHolder.sessionId = sessionId;
      act(() => {
        renderer.update(React.createElement(Harness));
      });
    },
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

describe('useChatTabScope refreshChatTokenLabel 防抖（T-TC6）', () => {
  let harness: Awaited<ReturnType<typeof mountScopeHarness>> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // meta 查询挂起：refreshChatMeta 停在 getCurrentModelId，不链触发标签刷新。
    loadChatAgentMetaMock.mockImplementation(
      () => createDeferred<unknown>().promise,
    );
  });

  afterEach(() => {
    harness?.unmount();
    harness = undefined;
    jest.useRealTimers();
  });

  it('rapid 双触发（间隔 100ms）合并为一次 service 调用；窗口内不执行', async () => {
    harness = await mountScopeHarness();

    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(100); // < 300ms：第二击落进同一窗口并重置计时
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(299); // 距第二击 299ms：仍在窗口内
      await flushMicrotasks();
    });
    expect(loadLabelMock).not.toHaveBeenCalled();

    // 距第二击满 300ms：trailing 到期，双触发合并成的一次调用才发起。
    await act(async () => {
      jest.advanceTimersByTime(1);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);
  });

  it('并发 5 触发在途合并为一次 service 调用', async () => {
    harness = await mountScopeHarness();

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        void harness.api().refreshChatTokenLabel();
      }
      await flushMicrotasks();
    });
    expect(loadLabelMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);
  });

  it('trailing：窗口过后必有最终一次计算，且不吞任何一击', async () => {
    harness = await mountScopeHarness();

    // 第一击：窗口过后必产生一次计算（最终一致性，不悬挂）。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 第二击（上一轮已完成、无在途）：同样不被吞，又产生一次计算。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);
  });

  it('计算在途时新触发复用在途（不并发第二轮），追赶轮保证最终一致', async () => {
    harness = await mountScopeHarness();
    // 第一轮 service 调用挂起（受控 deferred）：制造「计算在途」窗口。
    const pendingLabel = createDeferred<string>();
    loadLabelMock.mockImplementationOnce(() => pendingLabel.promise);

    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 在途期间再触发 + 追赶计时到期：复用在途并串行排队，不并发第二轮。
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 放行第一轮：排队的追赶轮随后执行（新触发最终必被计算）。
    await act(async () => {
      pendingLabel.resolve('9K tokens · 预估');
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);
  });

  it('B-1 场景①：升级回调带会话身份闸——切会话后旧会话的升级标签不写进新会话 meta', async () => {
    // 本用例需要 meta 真实落地（tokenLabel 写入面）：放行 loadChatAgentMeta，
    // 退出本文件其余用例的「meta 挂起」约定（其余用例在 beforeEach 重挂挂起）。
    loadChatAgentMetaMock.mockResolvedValue({
      tokenLabel: '',
      modelName: 'gpt-4o',
      agentName: 'a',
      projectName: 'p',
    });
    harness = await mountScopeHarness({modelId: 'gpt-4o'});

    // 按会话记录 service 传入的升级回调（挂载链可能自带一次自动刷新，
    // 用「最近一次」取用，不依赖调用次数/顺序）。
    const callbacksBySession = new Map<string, (label: string) => void>();
    loadLabelMock.mockImplementation(
      async (
        _runtime: unknown,
        scope: {sessionId: string},
        onUpgrade?: unknown,
      ) => {
        if (typeof onUpgrade === 'function') {
          callbacksBySession.set(
            scope.sessionId,
            onUpgrade as (label: string) => void,
          );
        }
        return '1K tokens · 预估';
      },
    );

    // s1 刷新：首帧标签落地。
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(callbacksBySession.has('s1')).toBe(true);
    expect(harness!.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // 切到 s2 并刷新：s2 首帧标签落地。
    harness!.setSessionId('s2');
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(callbacksBySession.has('s2')).toBe(true);
    expect(harness!.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // s1 的升级现在才回来：身份闸（tokenLabelSessionRef 已是 s2）应丢弃，
    // meta 不得出现旧会话的精确标签。
    await act(async () => {
      callbacksBySession.get('s1')!('glm = 99.3k / 128k (78%)');
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // s2 自己的升级回调照常写回。
    await act(async () => {
      callbacksBySession.get('s2')!('gpt = 24k / 128k (19%)');
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('gpt = 24k / 128k (19%)');
  });

  it('切会话立即清 chip（2026-09-30 用户实报残留）：旧数字一帧都不许出现，在途读数被身份闸丢弃', async () => {
    loadChatAgentMetaMock.mockResolvedValue({
      tokenLabel: '',
      modelName: 'gpt-4o',
      agentName: 'a',
      projectName: 'p',
    });
    harness = await mountScopeHarness({modelId: 'gpt-4o'});

    // s1 的刷新挂起（受控）：制造「读数在途」窗口。
    const pendingS1 = createDeferred<string>();
    loadLabelMock.mockImplementationOnce(() => pendingS1.promise);

    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 切到 s2：**立即**必须是加载态——上一会话的数字（哪怕它还挂在 state 里）
    // 不许以任何形式漏到新会话的 chip 上。
    harness!.setSessionId('s2');
    expect(harness!.api().agentMeta?.tokenLabel).toBe('…');

    // s1 的在途读数现在才回来：身份闸丢弃，s2 保持加载态。
    await act(async () => {
      pendingS1.resolve('glm = 69k / 128k (54%)');
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('…');

    // s2 自己的刷新照常落地新数字（Once：不污染后续用例的默认实现——
    // clearAllMocks 只清调用记录不清 implementation）。
    loadLabelMock.mockImplementationOnce(async () => 'gpt = 24k / 128k (19%)');
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('gpt = 24k / 128k (19%)');
  });
});

describe('useChatTabScope refreshChatTokenLabel run 在途冻结（2026-09-30）', () => {
  let harness: Awaited<ReturnType<typeof mountScopeHarness>> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // meta 查询挂起：refreshChatMeta 停在 getCurrentModelId，不链触发标签刷新。
    loadChatAgentMetaMock.mockImplementation(
      () => createDeferred<unknown>().promise,
    );
  });

  afterEach(() => {
    harness?.unmount();
    harness = undefined;
    jest.useRealTimers();
  });

  it('run 在途时，已显示过标签的刷新触发被冻结；run 结束后的触发照常计算', async () => {
    const abortState = {inFlight: false};
    harness = await mountScopeHarness({abortHas: () => abortState.inFlight});

    // run 前一轮正常刷新：刷出标签（hasLabel 判据置位）。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // run 在途：转录/append/settle 连发触发，防抖到期后全被冻结闸拦下。
    // 分两批各过一次 300ms 窗口，确认不是只冻第一轮。
    await act(async () => {
      abortState.inFlight = true;
      for (let i = 0; i < 3; i++) {
        void harness.api().refreshChatTokenLabel();
      }
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // run 结束（registry 已反注册，core finally 先于防抖到期）：结束沿的
    // 触发（onSettled / 末条转录事件）照常计算，chip 补上新读数。
    await act(async () => {
      abortState.inFlight = false;
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);
  });

  it('切进运行中的会话：首帧不冻（否则 chip 空白到 run 结束），第二击起冻结', async () => {
    harness = await mountScopeHarness({abortHas: () => true});

    // 首帧照算：hasLabel 尚未置位，冻结不生效——否则切进运行中会话时
    // chip 会一直空白到 run 结束。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 首帧刷出标签后：同样 run 在途，第二击起冻结。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);
  });

  it('中途弃权（服务返回空串哨兵）：chip 保留旧标签，不清空', async () => {
    // meta 真实落地（tokenLabel 写入面可断言）——同 B-1 用例的退出挂起约定。
    loadChatAgentMetaMock.mockResolvedValue({
      tokenLabel: '',
      modelName: 'gpt-4o',
      agentName: 'a',
      projectName: 'p',
    });
    harness = await mountScopeHarness({modelId: 'gpt-4o'});

    // 第一轮正常刷出标签。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(harness.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // 第二轮被 run 起步打断（服务层 shouldBail 命中返回 ''）：旧标签保留，
    // 绝不能把 chip 清成空/占位。
    loadLabelMock.mockImplementationOnce(async () => '');
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(harness.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');
  });
});

describe('useChatTabScope refreshChatTokenLabel 压缩预热冻结闸（r3-test-1 ③）', () => {
  let harness: Awaited<ReturnType<typeof mountScopeHarness>> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // meta 查询挂起：refreshChatMeta 停在 getCurrentModelId，不链触发标签刷新。
    loadChatAgentMetaMock.mockImplementation(
      () => createDeferred<unknown>().promise,
    );
  });

  afterEach(() => {
    harness?.unmount();
    harness = undefined;
    jest.useRealTimers();
  });

  it('预热在途（isChatTokenPreciseWarmInflight 翻真）：本轮不排程、零 service 调用；预热落定后下一击照常计算', async () => {
    // 压缩暖机窗口（runCompactionWithTokenWarm → warmChatTokenLabelAfterCompaction）
    // 里 chip 冻结在旧标签，等预热算出的精确档由压缩流程补写。这道闸在防抖
    // 排程**之前**：命中即 return，连计时器都不建——否则窗口内的转录/settle
    // 触发会各起一轮抢跑，把预热那一轮整串计数的时间预算吃掉。
    //
    // 旧覆盖（run 在途冻结那组）只钉 abortRegistry.has 那一道闸；本组钉的是
    // 同函数里紧邻的 isChatTokenPreciseWarmInflight 那道——删掉它本用例立刻红
    // （300ms 窗口过后 service 被调 1 次）。
    const warm = {inflight: false};
    warmInflightMock.mockImplementation(() => warm.inflight);
    harness = await mountScopeHarness();

    // 预热前一轮正常计算：把「窗口外读口是通的」这一前提立起来。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 预热窗口内：翻真 → 触发不排程。窗口跨过两轮 300ms 仍零调用
    // （闸若只挡一次，第二轮就会漏进来）。
    await act(async () => {
      warm.inflight = true;
      for (let i = 0; i < 2; i++) {
        void harness.api().refreshChatTokenLabel();
        jest.advanceTimersByTime(300);
        await flushMicrotasks();
      }
    });
    expect(warmInflightMock).toHaveBeenCalled();
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 预热落定：下一击照常排程计算（闸不吞触发，chip 由压缩流程补写后
    // 还能继续跟读数）。
    await act(async () => {
      warm.inflight = false;
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);
  });
});
