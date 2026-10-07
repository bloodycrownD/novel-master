/**
 * message-token-cache Step 4 / T-TC6：refreshChatTokenLabel 防抖守护。
 *
 * hook 读口已套 300ms trailing debounce + 同 key 在途复用（useChatTabScope 内
 * 单槽状态机，与 desktop service 层同款语义）。本套件用 jest 假计时器钉住：
 * - rapid 双触发（间隔 <300ms）合并为一次 service 调用；
 * - 并发 5 触发在途合并为一次 service 调用；
 * - trailing 语义：窗口内不执行、窗口过后必有最终一次计算、不吞任何一击；
 * - 计算在途时新触发复用在途（不并发第二轮），随后追赶轮保证新数据最终被算。
 * - 前置冻结闸：run 在途（abortRegistry.has，有标签可保才冻）。
 * - 精确升级的延迟收口（cr2-E-2）：切会话按「发起那一轮」的会话身份 cancel
 *   升级延迟计时；卸载 cleanup 经 ref 收口；shouldBailPrecise 双条件认会话身份
 *   （视图仍在 conversation 时也能拦下旧会话的挂起升级）。
 *
 * 只 mock runtime 与 meta/token 服务；被测 hook 用真实实现。meta 查询全程
 * 挂起（refreshChatMeta 停在 getCurrentModelId），排除挂载链对 token 标签
 * 触发次数的干扰，断言面只剩手动触发的 refreshChatTokenLabel。
 *
 * 例外两组（r4 增补）：refreshChatMeta 会话身份闸（r4-app-1）与切会话清场
 * 机制锁（r4-app-2）要观测 meta 落地面 / 源码机制，各自放行 getCurrentModelId
 * 与受控 meta 查询，不依赖上面的「meta 挂起」默认约定。
 */
import {readFileSync} from 'fs';
import {join} from 'path';
import {beforeEach, afterEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';
import {
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '../src/services/chat-agent-meta';
import {
  cancelPreciseUpgrade,
  cancelPreciseUpgradeDelay,
  loadChatPromptTokenLabelResilient,
} from '../src/services/chat-prompt-tokens.service';

const HOOK_PATH = join(
  __dirname,
  '../src/screens/tabs/chat-tab/useChatTabScope.ts',
);

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => '1K tokens · 预估'),
  // hook 侧换会话/卸载时的精确升级延迟计时收口出口（cr2-E-2）
  cancelPreciseUpgradeDelay: jest.fn(),
  // 在途原生精确计数的取消下发出口（tokenizer-native-cancel，与上者同点并调）
  cancelPreciseUpgrade: jest.fn(),
}));

const loadChatAgentMetaMock = loadChatAgentMeta as jest.Mock;
const loadLabelMock = loadChatPromptTokenLabelResilient as jest.Mock;
const cancelDelayMock = cancelPreciseUpgradeDelay as jest.Mock;
const cancelMock = cancelPreciseUpgrade as jest.Mock;

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

/** meta 形状与真实 loadChatAgentMeta 的 session 档对齐（只断言 agentName/modelLabel）。 */
function buildMeta(agentName: string, modelLabel: string): ChatAgentMeta {
  return {
    source: 'session',
    agentId: 'a1',
    agentName,
    modelLabel,
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  };
}

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
  // 稳定引用：消费方 context 每次渲染给新函数会连锁重建 hook 的 dep（hook 内
  // 已用 ref 取最新引用），这里稳定下来，测试侧才好断言「闸拦下的失败不弹提示」。
  const showToastMock = jest.fn();
  let api: ReturnType<typeof useChatTabScope> | undefined;
  const Harness = () => {
    api = useChatTabScope({
      runtime,
      projectId: 'p1',
      sessionId: sessionHolder.sessionId,
      setCurrentProject: jest.fn(async () => undefined),
      setCurrentSession: jest.fn(async () => undefined),
      refreshScope: jest.fn(async () => undefined),
      showToast: showToastMock,
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
    showToast: showToastMock,
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
      jest.advanceTimersByTime(100); // 窗口内：第二击落进同一窗口并重置计时
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(50);
      await flushMicrotasks();
    });
    expect(loadLabelMock).not.toHaveBeenCalled();

    // 推进覆盖任一窗口（新会话首刷长窗 1200ms）：双触发合并成的一次调用才发起。
    // 不在 1200 边界逐毫断言——RN preset 的 fake timers 对 hook 内 setTimeout
    // 的推进语义不可靠（2026-10-01 实测 advance(100) 能 fire 1200ms 的 timer），
    // 窗口精确性由 useChatTabScope 源码静态保证，这里只锁合并语义。
    await act(async () => {
      jest.advanceTimersByTime(2000);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);
  });

  it('trailing：窗口过后必有最终一次计算，且不吞任何一击', async () => {
    harness = await mountScopeHarness();

    // 第一击：窗口过后必产生一次计算（最终一致性，不悬挂）。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 第二击（上一轮已完成、无在途）：同样不被吞，又产生一次计算。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 在途期间再触发 + 追赶计时到期：复用在途并串行排队，不并发第二轮。
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(callbacksBySession.has('s1')).toBe(true);
    expect(harness!.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // 切到 s2 并刷新：s2 首帧标签落地。
    harness!.setSessionId('s2');
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
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

  it('切会话立即清 chip（r4-app-2/4）：s1 旧数字真落地过，切会话一帧不漏，在途读数被身份闸丢弃', async () => {
    loadChatAgentMetaMock.mockResolvedValue({
      tokenLabel: '',
      modelName: 'gpt-4o',
      agentName: 'a',
      projectName: 'p',
    });
    harness = await mountScopeHarness({modelId: 'gpt-4o'});

    // 先让 s1 的标签**真落地**（防抖到期 + 读数回填出非 '…' 的值）：切会话前
    // chip 上摆着旧会话的数字，「切走即归位 '…'」才有前提——否则切会话瞬间
    // state 本来就是 '…'，删掉清场 effect 也照样过（r4-app-4 旧断言恒真）。
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // 再制造「s1 还有一轮读数在途」的窗口（受控 deferred）。
    const pendingS1 = createDeferred<string>();
    loadLabelMock.mockImplementationOnce(() => pendingS1.promise);
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);

    // 切到 s2：**首个 commit 即**加载态（清场是 pre-paint 的布局阶段，
    // r4-app-2）——上一会话的数字（'1K tokens · 预估'，此刻还挂在 state 里）
    // 不许以任何形式漏到新会话的 chip 上，一帧都不行。
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.tokenLabel).toBe('gpt = 24k / 128k (19%)');
  });
});

describe('useChatTabScope 精确升级的会话身份弃权与延迟收口（cr2-E-2）', () => {
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

  it('s1 首帧挂起 → 切 s2：按发起轮身份收口升级延迟，越窗后 s1 的升级不发生', async () => {
    harness = await mountScopeHarness();
    // 视图先拨到 conversation：**只看视图的旧判据在这里恒为 false**，拦不下
    // 旧会话的挂起升级——必须靠会话身份这一条（判据升级成双条件才拦得住）。
    await act(async () => {
      harness!.api().setChatSubview('conversation');
      await flushMicrotasks();
    });

    const bailBySession = new Map<string, () => boolean>();
    loadLabelMock.mockImplementation(
      async (
        _runtime: unknown,
        scope: {sessionId: string},
        _onUpgrade?: unknown,
        options?: {shouldBailPrecise?: () => boolean},
      ) => {
        if (options?.shouldBailPrecise != null) {
          bailBySession.set(scope.sessionId, options.shouldBailPrecise);
        }
        return '1K tokens · 预估';
      },
    );

    // s1 首帧：此刻展示身份还是 s1、视图也在 conversation → 不该弃权。
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(bailBySession.get('s1')?.()).toBe(false);

    // 切到 s2 并刷新：换 key 分支按「发起那一轮」的身份收口 s1 的挂起计时
    // （读 slot.sessionId 必须在 slot.key 赋值之前，否则 cancel 打的是新会话）。
    harness!.setSessionId('s2');
    await act(async () => {
      void harness!.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(cancelDelayMock).toHaveBeenCalledWith('s1');
    // T-TC6：在途原生计数的取消与延迟收口**同点并调、同参**（都是发起那一轮
    // 的会话身份，不是当前会话）。
    expect(cancelMock).toHaveBeenCalledWith('s1');

    // s1 那轮若仍被启动（越窗时刻）：判据已改判 true → 升级重活一行不跑。
    expect(bailBySession.get('s1')?.()).toBe(true);
    // s2 自己的升级不受牵连。
    expect(bailBySession.get('s2')?.()).toBe(false);
  });

  it('卸载 cleanup：按 ref 里最新一轮的会话身份收口挂起的升级延迟', async () => {
    harness = await mountScopeHarness();
    await act(async () => {
      harness!.api().setChatSubview('conversation');
      void harness!.api().refreshChatTokenLabel();
      await flushMicrotasks();
    });
    cancelDelayMock.mockClear();
    cancelMock.mockClear();

    // 计时还挂着（没推进窗口）就卸载：cleanup 经 ref 读到 's1' 收口。
    harness!.unmount();
    harness = undefined;
    expect(cancelDelayMock).toHaveBeenCalledWith('s1');
    // T-TC6：卸载同样下发在途取消（同点并调、同参）。
    expect(cancelMock).toHaveBeenCalledWith('s1');
  });
});

describe('useChatTabScope refreshChatMeta 会话身份闸（r4-app-1）', () => {
  let harness: Awaited<ReturnType<typeof mountScopeHarness>> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    harness?.unmount();
    harness = undefined;
    jest.useRealTimers();
  });

  /**
   * 按会话记录挂起的 meta 查询：s1 / s2 各一轮受控，谁先放行由测试决定。
   * getCurrentModelId 走 modelId 选项（立即 resolve），refreshChatMeta 才能
   * 推进到 meta 落定那一步。
   */
  function hangMetaBySession() {
    const metaBySession = new Map<string, Deferred<ChatAgentMeta>>();
    loadChatAgentMetaMock.mockImplementation(
      (_runtime: unknown, _projectId: string, sid: string) => {
        const deferred = createDeferred<ChatAgentMeta>();
        metaBySession.set(sid, deferred);
        return deferred.promise;
      },
    );
    return metaBySession;
  }

  it('s1 的 loadChatAgentMeta 落定晚于切会话：旧会话 meta 字段不写进新会话（成功分支）', async () => {
    const metaBySession = hangMetaBySession();
    harness = await mountScopeHarness({modelId: 'gpt-4o'});
    expect(metaBySession.has('s1')).toBe(true);

    // 切到 s2：新会话的 meta 轮立即发起（不复用 s1 在途），并先落地。
    harness!.setSessionId('s2');
    await act(async () => {
      await flushMicrotasks();
    });
    expect(metaBySession.has('s2')).toBe(true);
    await act(async () => {
      metaBySession.get('s2')!.resolve(buildMeta('Agent-S2', 'Model-S2'));
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.agentName).toBe('Agent-S2');
    expect(harness!.api().agentMeta?.modelLabel).toBe('Model-S2');

    // s1 的 meta 现在才落定：身份闸丢弃——新会话的字段一个都不许被覆盖。
    await act(async () => {
      metaBySession.get('s1')!.resolve(buildMeta('Agent-S1', 'Model-S1'));
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.agentName).toBe('Agent-S2');
    expect(harness!.api().agentMeta?.modelLabel).toBe('Model-S2');
  });

  it('s1 的 loadChatAgentMeta 失败晚于切会话：不清新会话 meta、不弹旧会话的错误（失败分支）', async () => {
    const metaBySession = hangMetaBySession();
    harness = await mountScopeHarness({modelId: 'gpt-4o'});

    harness!.setSessionId('s2');
    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      metaBySession.get('s2')!.resolve(buildMeta('Agent-S2', 'Model-S2'));
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.agentName).toBe('Agent-S2');
    harness!.showToast.mockClear();

    // s1 的 meta 以失败告终：失败清场同样过闸——新会话的 meta 不许被清成
    // 未加载态，也不该弹一条与新会话无关的错误提示。
    await act(async () => {
      metaBySession.get('s1')!.reject(new Error('chat config broken'));
      await flushMicrotasks();
    });
    expect(harness!.api().agentMeta?.agentName).toBe('Agent-S2');
    expect(harness!.showToast).not.toHaveBeenCalled();
  });
});

describe('useChatTabScope 切会话清场机制锁（r4-app-2 静态守卫）', () => {
  // jsdom + act 没有「绘制」这一步：act 会把 passive effect 一并冲掉，
  // useEffect / useLayoutEffect 的渲染序列完全一致——「旧数字一帧不漏」在行为
  // 断言里天然不可区分（改前源码就是 useEffect，同一条断言照样绿）。所以机制
  // 本身静态锁死：清场必须是 useLayoutEffect（提交后、绘制前），且第一句是
  // 会话身份交接（tokenLabelSessionRef 指到新会话）——两者任一被改回/删掉，
  // 这里立刻红灯，而不是等用户实报残留。
  const source = readFileSync(HOOK_PATH, 'utf8');

  it('清场走 useLayoutEffect（pre-paint）且先交接会话身份', () => {
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{\s*tokenLabelSessionRef\.current = sessionId/,
    );
  });

  it('chatSubviewRef 也走 useLayoutEffect（cr2-B-1：render 期赋值在并发根下可停在未提交值）', () => {
    // 同上，机制静态锁死：TestRenderer 不模拟并发渲染，行为断言区分不出
    // render body 赋值与布局阶段赋值——改回 render 期这里立刻红。
    expect(source).toMatch(
      /useLayoutEffect\(\(\)\s*=>\s*\{\s*chatSubviewRef\.current = chatSubview;\s*\},?\s*\[chatSubview\]\)/,
    );
  });

  it('守卫文件存在（防路径漂移导致空跑）', () => {
    expect(source).toContain('useChatTabScope');
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
      jest.advanceTimersByTime(1200);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // run 结束（registry 已反注册，core finally 先于防抖到期）：结束沿的
    // 触发（onSettled / 末条转录事件）照常计算，chip 补上新读数。
    await act(async () => {
      abortState.inFlight = false;
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 首帧刷出标签后：同样 run 在途，第二击起冻结。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
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
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(harness.api().agentMeta?.tokenLabel).toBe('1K tokens · 预估');

    // 第二轮被 run 起步打断（服务层 shouldBail 命中返回 ''）：旧标签保留，
    // 绝不能把 chip 清成空/占位。
    loadLabelMock.mockImplementationOnce(async () => '');
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(1200);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(2);
  });
});

