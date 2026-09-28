/**
 * message-token-cache Step 4 / T-TC6：refreshChatTokenLabel 防抖守护。
 *
 * hook 读口已套 300ms trailing debounce + 同 key 在途复用（useChatTabScope 内
 * 单槽状态机，与 desktop service 层同款语义）。本套件用 jest 假计时器钉住：
 * - rapid 双触发（间隔 <300ms）合并为一次 service 调用；
 * - 并发 5 触发在途合并为一次 service 调用；
 * - trailing 语义：窗口内不执行、窗口过后必有最终一次计算、不吞任何一击；
 * - 计算在途时新触发复用在途（不并发第二轮），随后追赶轮保证新数据最终被算。
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
import {loadChatPromptTokenLabelResilient} from '../src/services/chat-prompt-tokens.service';

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => '1K tokens · 预估'),
}));

const loadChatAgentMetaMock = loadChatAgentMeta as jest.Mock;
const loadLabelMock = loadChatPromptTokenLabelResilient as jest.Mock;

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
 * 挂载真实 hook；runtime 的 getCurrentModelId 与 loadChatAgentMeta 都挂起
 * （refreshChatMeta 永远停在半路），token 标签只能由测试手动触发。
 */
async function mountScopeHarness() {
  const runtime: any = {
    projects: {
      list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
      get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    },
    sessions: {listByProject: jest.fn(async () => [])},
    state: {
      getCurrentModelId: jest.fn(() => createDeferred<string>().promise),
    },
    sessionVfs: jest.fn(() => ({})),
    workplace: jest.fn(() => ({})),
    projectVfs: jest.fn(() => ({})),
  };
  let api: ReturnType<typeof useChatTabScope> | undefined;
  const Harness = () => {
    api = useChatTabScope({
      runtime,
      projectId: 'p1',
      sessionId: 's1',
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
      void harness.api().refreshChatTokenLabel();
      jest.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(loadLabelMock).toHaveBeenCalledTimes(1);

    // 在途期间再触发 + 追赶计时到期：复用在途并串行排队，不并发第二轮。
    await act(async () => {
      void harness.api().refreshChatTokenLabel();
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
});
